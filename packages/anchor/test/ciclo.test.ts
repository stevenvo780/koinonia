/**
 * El ciclo completo: tres proveedores, quórum y **constancia en el ledger**.
 *
 * La propiedad que se defiende aquí es que **ninguna falla se traga**. Un proveedor que revienta no
 * deja el sistema en verde y callado: deja un `AnclajeFallido` dentro del agregado `#anclaje`, que
 * está dentro de la estructura protegida. Para ocultarlo hay que alterar el ledger, y alterar el
 * ledger es lo que el anclaje detecta.
 */

import {
  ANCHOR_AGGREGATE_ID,
  ANCHOR_AGGREGATE_TYPE,
  ANCHOR_CONFIRMED,
  ANCHOR_FAILED,
  ANCHOR_STATE_PUBLISHED,
  checkpointBindingLine,
  commitOid,
  FakeOtsCalendar,
  OpenTimestampsProvider,
  runAnchorCycle,
  SignedGitProvider,
  WitnessEmailProvider,
  withAcks,
  ackPreimage,
  ackSignedBytes,
  WITNESS_SIGNATURE_NAMESPACE,
  type AnchorEventDraft,
  type AnchorLedgerPort,
  type AnchorProvider,
  type AnchorReceipt,
  type CheckpointRef,
} from '@koinonia/anchor';
import { toBase64Url, toHex } from '@koinonia/crypto';
import { describe, expect, it } from 'vitest';

import { commitFirmado, nuevoFirmante, relojFijo, T_AHORA, T_EMISION, texto } from './testigos.js';

const CHECKPOINT_HASH = new Uint8Array(32).fill(0x3d);
const HEX = toHex(CHECKPOINT_HASH);

const CHECKPOINT: CheckpointRef = {
  treeSize: 12_480n,
  rootHash: new Uint8Array(32).fill(0x11),
  headsRoot: new Uint8Array(32).fill(0x22),
  checkpointHash: CHECKPOINT_HASH,
  issuedAt: T_EMISION,
};

function ledgerDePrueba(): { port: AnchorLedgerPort; eventos: AnchorEventDraft[] } {
  const eventos: AnchorEventDraft[] = [];
  return {
    eventos,
    port: {
      registrar: (nuevos) => {
        eventos.push(...nuevos);
        return Promise.resolve();
      },
    },
  };
}

async function tresProveedores(opciones: { readonly claveFuera?: boolean } = {}) {
  const calendario = new FakeOtsCalendar();
  const ots = new OpenTimestampsProvider({
    calendar: calendario,
    headers: calendario.headerSource(),
    clock: relojFijo(T_AHORA),
  });

  const firmante = await nuevoFirmante();
  const git = new SignedGitProvider({
    allowedSigners: [{ identity: 'Veeduría', publicKey: firmante.publicKey }],
    signingKeyOffHost: opciones.claveFuera ?? true,
    forges: ['codeberg', 'github'],
    clock: relojFijo(T_AHORA),
  });

  const testigo = await nuevoFirmante();
  const correo = new WitnessEmailProvider({
    witnesses: [{ id: 'externa', address: 'carla@externa.example', publicKey: testigo.publicKey }],
    minDistinctDomains: 1,
    clock: relojFijo(T_AHORA),
  });

  return { calendario, ots, git, correo, firmante, testigo };
}

async function reciboGit(firmante: Awaited<ReturnType<typeof nuevoFirmante>>) {
  const mensaje = `Checkpoint 12480\n\n${checkpointBindingLine(HEX)}\n`;
  const bytes = await commitFirmado(firmante, mensaje);
  return {
    provider: 'git',
    independenceClass: 'vcs' as const,
    checkpointHash: HEX,
    externalRef: await commitOid(bytes),
    submittedAt: T_EMISION,
    confirmedAt: T_AHORA,
    proof: toBase64Url(bytes),
    raw: { forgesSeen: ['codeberg', 'github'] },
  };
}

async function reciboCorreo(
  correo: WitnessEmailProvider,
  testigo: Awaited<ReturnType<typeof nuevoFirmante>>,
): Promise<AnchorReceipt> {
  const base = await correo.submit(CHECKPOINT_HASH);
  const seenAt = '2026-08-21T03:30:00.000Z';
  const firma = await testigo.firmar(
    WITNESS_SIGNATURE_NAMESPACE,
    ackSignedBytes(
      ackPreimage({
        address: 'carla@externa.example',
        checkpointHash: HEX,
        messageId: base.externalRef,
        seenAt,
        witness: 'externa',
      }),
    ),
  );
  return withAcks(
    base,
    [{ witness: 'externa', address: 'carla@externa.example', seenAt, signature: firma }],
    T_AHORA,
  );
}

describe('runAnchorCycle', () => {
  it('primer ciclo: todo pendiente, estado NO ANCLADO y constancia en el ledger', async () => {
    const { ots, git, correo } = await tresProveedores();
    const { port, eventos } = ledgerDePrueba();

    const resultado = await runAnchorCycle({
      checkpoint: CHECKPOINT,
      providers: [ots, git, correo],
      ledger: port,
      now: T_AHORA,
    });

    expect(resultado.verdict.firm).toBe(false);
    expect(resultado.verdict.state).toBe('NO_ANCLADO');
    expect(resultado.verdict.rejected.map((r) => r.reason)).toStrictEqual([
      'no-confirmado',
      'no-confirmado',
      'no-confirmado',
    ]);

    // Tres intentos + la publicación del estado. La falla nunca es silenciosa.
    expect(eventos.map((e) => e.eventType)).toStrictEqual([
      'AnclajeIntentado',
      'AnclajeIntentado',
      'AnclajeIntentado',
      ANCHOR_STATE_PUBLISHED,
    ]);
    const estado = eventos.at(-1)!;
    expect(estado.payload['estado']).toBe('NO_ANCLADO');
    expect(estado.payload['firme']).toBe(false);
    expect(estado.payload['treeSize']).toBe(12_480);
  });

  it('dos clases distintas confirmadas: FIRME, y queda escrito quién ancló', async () => {
    const { calendario, ots, git, correo, firmante } = await tresProveedores();
    const { port, eventos } = ledgerDePrueba();

    const otsMaduro = await ots.poll(await ots.submit(CHECKPOINT_HASH));
    void calendario;

    const resultado = await runAnchorCycle({
      checkpoint: CHECKPOINT,
      providers: [ots, git, correo],
      ledger: port,
      now: T_AHORA,
      existing: [otsMaduro, await reciboGit(firmante)],
    });

    expect(resultado.verdict.firm).toBe(true);
    expect(resultado.verdict.state).toBe('FIRME');
    expect(resultado.verdict.confirmedClasses).toStrictEqual(['blockchain', 'vcs']);

    const confirmados = eventos.filter((e) => e.eventType === ANCHOR_CONFIRMED);
    expect(confirmados).toHaveLength(2);
    for (const evento of confirmados) {
      expect(texto(evento.payload['receiptHash'])).toMatch(/^[0-9a-f]{64}$/u);
      expect(evento.payload['checkpointHash']).toBe(HEX);
    }
  });

  it('las tres clases: FIRME con las tres, y el correo aporta la tercera', async () => {
    const { ots, git, correo, firmante, testigo } = await tresProveedores();
    const otsMaduro = await ots.poll(await ots.submit(CHECKPOINT_HASH));

    const resultado = await runAnchorCycle({
      checkpoint: CHECKPOINT,
      providers: [ots, git, correo],
      now: T_AHORA,
      existing: [otsMaduro, await reciboGit(firmante), await reciboCorreo(correo, testigo)],
    });

    expect(resultado.verdict.confirmedClasses).toStrictEqual([
      'blockchain',
      'human-witness',
      'vcs',
    ]);
    expect(resultado.verdict.firm).toBe(true);
  });

  it('un proveedor que revienta al enviar deja AnclajeFallido con el motivo', async () => {
    const { ots, git } = await tresProveedores();
    const roto: AnchorProvider = {
      meta: {
        id: 'roto',
        independenceClass: 'third-party-log',
        trustAssumption: 'ninguna',
        verificationNeedsNetwork: true,
        signingKeyOffHost: true,
        maturationHint: 'nunca',
      },
      submit: () => Promise.reject(new Error('el log público respondió 503')),
      verify: () => Promise.reject(new Error('no debería llamarse')),
    };
    const { port, eventos } = ledgerDePrueba();

    const resultado = await runAnchorCycle({
      checkpoint: CHECKPOINT,
      providers: [ots, git, roto],
      ledger: port,
      now: T_AHORA,
    });

    const fallidos = eventos.filter((e) => e.eventType === ANCHOR_FAILED);
    expect(fallidos).toHaveLength(1);
    expect(texto(fallidos[0]!.payload['motivo'])).toMatch(/503/u);
    expect(fallidos[0]!.payload['provider']).toBe('roto');
    // El ciclo NO se cae: los otros dos siguen su curso.
    expect(resultado.attempts).toHaveLength(3);
    expect(resultado.attempts.find((a) => a.provider === 'roto')?.receipt).toBeUndefined();
  });

  it('un recibo INVÁLIDO produce AnclajeFallido, no un silencio', async () => {
    const { calendario, ots, git, correo } = await tresProveedores();
    const emisor = new OpenTimestampsProvider({ calendar: calendario, clock: relojFijo(T_AHORA) });
    const ajeno = await emisor.poll(await emisor.submit(new Uint8Array(32).fill(0x99)));
    const { port, eventos } = ledgerDePrueba();

    await runAnchorCycle({
      checkpoint: CHECKPOINT,
      providers: [ots, git, correo],
      ledger: port,
      now: T_AHORA,
      // Recibo reetiquetado con nuestro hash: el sello sigue siendo de otro checkpoint.
      existing: [{ ...ajeno, checkpointHash: HEX }],
    });

    const fallidos = eventos.filter((e) => e.eventType === ANCHOR_FAILED);
    expect(fallidos).toHaveLength(1);
    expect(texto(fallidos[0]!.payload['motivo'])).toMatch(/el sello no es de este checkpoint/u);
  });

  it('con la clave de git en el servidor, el ciclo NO llega a FIRME', async () => {
    const { ots, git, correo, firmante } = await tresProveedores({ claveFuera: false });
    const otsPendiente = await ots.submit(CHECKPOINT_HASH);

    const resultado = await runAnchorCycle({
      checkpoint: CHECKPOINT,
      providers: [ots, git, correo],
      now: T_AHORA,
      existing: [otsPendiente, await reciboGit(firmante)],
    });

    expect(resultado.verdict.firm).toBe(false);
    expect(resultado.verdict.rejected.find((r) => r.provider === 'git')?.reason).toBe(
      'clave-en-el-servidor-verificado',
    );
  });

  it('a las 72 h sin quórum el ciclo marca las decisiones del lapso', async () => {
    const { ots, git, correo } = await tresProveedores();
    const { port, eventos } = ledgerDePrueba();

    await runAnchorCycle({
      checkpoint: CHECKPOINT,
      providers: [ots, git, correo],
      ledger: port,
      now: '2026-08-24T04:00:00.000Z', // 73 h después de la emisión
    });

    const estado = eventos.at(-1)!;
    expect(estado.eventType).toBe(ANCHOR_STATE_PUBLISHED);
    expect(estado.payload['estado']).toBe('NO_ANCLADO_CRITICO');
    expect(estado.payload['decisionesPendientesDeIntegridad']).toBe(true);
    expect(estado.payload['horasDesdeEmision']).toBe(73);
  });

  it('el agregado del anclaje es el singleton `#anclaje`', () => {
    expect(ANCHOR_AGGREGATE_ID).toMatch(/^[0-9a-f]{32}$/u);
    expect(ANCHOR_AGGREGATE_TYPE).toBe('#anclaje');
  });
});
