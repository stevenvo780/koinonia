/**
 * El bucle completo, contra PostgreSQL de verdad:
 *
 *     escribir → sellar → anclar fuera → exportar → **verificar con el verificador independiente**
 *
 * Es la única prueba que cierra el círculo. Las de `packages/verifier-cli` construyen sus exports a
 * mano, a propósito, para que un error compartido entre exportador y verificador no quede oculto;
 * pero eso deja una pregunta abierta: ¿el exportador REAL produce algo que el verificador acepta?
 * Aquí se responde, y de paso se comprueba que las fallas de anclaje quedan dentro del ledger.
 */

import {
  ackPreimage,
  ackSignedBytes,
  armorSshSignature,
  buildCommitBytes,
  buildSshSignatureBlob,
  checkpointBindingLine,
  commitOid,
  FakeOtsCalendar,
  OpenTimestampsProvider,
  runAnchorCycle,
  SignedGitProvider,
  sshPublicKeyBlob,
  sshSignedBlob,
  toBase64,
  WITNESS_SIGNATURE_NAMESPACE,
  withAcks,
  WitnessEmailProvider,
  type AnchorProvider,
  type AnchorReceipt,
} from '@koinonia/anchor';
import {
  ANCHOR_AGGREGATE_ID,
  anchorLedgerPort,
  append,
  buildExport,
  emitCheckpoint,
  latestCheckpoint,
  readAnchorReceipts,
  readStream,
  saveAnchorAttempt,
  saveBitcoinHeader,
  verifyLedger,
} from '@koinonia/api';
import { toBase64Url, toHex } from '@koinonia/crypto';
import { memorySource, SALIDA, verificarExport, type TrustRoster } from '@koinonia/verificar';
import { afterAll, describe, expect, it } from 'vitest';

import { id32, iso, ledgerEnv, ready, requestId, skipNote } from './helpers/ledger-env.js';

const env = await ledgerEnv();
const AHORA = '2026-08-21T18:00:00.000Z';

const subtle = globalThis.crypto.subtle;
type Clave = Awaited<ReturnType<typeof subtle.importKey>>;

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
  const blob = sshPublicKeyBlob('ssh-ed25519', raw);
  return {
    publicKey: toBase64(blob),
    async firmar(namespace, message) {
      const firmado = await sshSignedBlob(namespace, new Uint8Array(0), 'sha512', message);
      const signature = new Uint8Array(
        await subtle.sign({ name: 'Ed25519' }, pair.privateKey, firmado),
      );
      return armorSshSignature(
        buildSshSignatureBlob({
          publicKeyBlob: blob,
          namespace,
          hashAlgorithm: 'sha512',
          signatureType: 'ssh-ed25519',
          signature,
        }),
      );
    },
  };
}

describe(`anclaje externo y export verificable${skipNote(env)}`, () => {
  const listo = env.ok ? ready(env) : undefined;
  afterAll(async () => {
    if (listo !== undefined) await listo.stop();
  });

  it.skipIf(!env.ok)('el export del servidor real pasa el verificador independiente', async () => {
    const { appPool } = ready(env);
    const decision = id32('acta-de-marzo');
    const otra = id32('presupuesto-eventos');

    // ── 1. Historia ──────────────────────────────────────────────────────────────────────────
    await append(appPool, {
      aggregateId: decision,
      aggregateType: 'decision',
      expectedHead: { kind: 'new' },
      requestId: requestId('redactar'),
      events: [
        {
          eventType: 'DecisionRedactada',
          occurredAt: iso(1000),
          payload: { resumen: 'Aprobar el acta de la asamblea del 3 de marzo' },
        },
        { eventType: 'DecisionAbierta', occurredAt: iso(2000), payload: { ronda: 1 } },
      ],
    });

    await emitCheckpoint(appPool, { issuedAt: iso(3000), requestId: requestId('sello-1') });

    await append(appPool, {
      aggregateId: otra,
      aggregateType: 'decision',
      expectedHead: { kind: 'new' },
      requestId: requestId('redactar-2'),
      events: [
        {
          eventType: 'DecisionRedactada',
          occurredAt: iso(4000),
          payload: { resumen: 'Repartir el presupuesto de eventos' },
        },
      ],
    });
    await append(appPool, {
      aggregateId: decision,
      aggregateType: 'decision',
      expectedHead: { kind: 'any' },
      requestId: requestId('papeleta'),
      events: [
        {
          eventType: 'PapeletaEmitida',
          occurredAt: iso(5000),
          actor: id32('ana'),
          payload: { voto: 'si' },
        },
      ],
    });

    const sello = await emitCheckpoint(appPool, {
      issuedAt: iso(6000),
      requestId: requestId('sello-2'),
    });

    // ── 2. Anclaje externo con las tres clases ───────────────────────────────────────────────
    const calendario = new FakeOtsCalendar({ firstHeight: 921_447, firstBlockTime: 1_787_200_000 });
    const ots = new OpenTimestampsProvider({
      calendar: calendario,
      headers: calendario.headerSource(),
      clock: () => AHORA,
    });

    const veeduria = await nuevoFirmante();
    const git = new SignedGitProvider({
      allowedSigners: [{ identity: 'Veeduría 2026-2', publicKey: veeduria.publicKey }],
      // La clave vive en el equipo de la veeduría. Con `false`, el quórum la descontaría.
      signingKeyOffHost: true,
      forges: ['codeberg', 'github'],
      clock: () => AHORA,
    });

    const testigoUno = await nuevoFirmante();
    const testigoDos = await nuevoFirmante();
    const padron = [
      { id: 'docente', address: 'ana@correo.example', publicKey: testigoUno.publicKey },
      { id: 'externa', address: 'carla@externa.example', publicKey: testigoDos.publicKey },
    ];
    const correo = new WitnessEmailProvider({
      witnesses: padron,
      minDistinctDomains: 2,
      clock: () => AHORA,
    });

    const proveedores: readonly AnchorProvider[] = [ots, git, correo];
    const hex = toHex(sello.checkpointHash);

    // La veeduría firma en SU equipo y empuja; aquí eso llega como un recibo ya hecho.
    const autor = 'Veeduria <veeduria@ejemplo.org> 1787200000 +0000';
    const base = {
      tree: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      author: autor,
      committer: autor,
      message: `Checkpoint ${String(sello.treeSize)}\n\n${checkpointBindingLine(hex)}\n`,
    };
    const objeto = buildCommitBytes({
      ...base,
      signature: await veeduria.firmar('git', buildCommitBytes(base)),
    });
    const reciboGit: AnchorReceipt = {
      provider: 'git',
      independenceClass: 'vcs',
      checkpointHash: hex,
      externalRef: await commitOid(objeto),
      submittedAt: AHORA,
      confirmedAt: AHORA,
      proof: toBase64Url(objeto),
      raw: { forgesSeen: ['codeberg', 'github'] },
    };

    const baseCorreo = await correo.submit(sello.checkpointHash);
    const acuses = [];
    for (const [indice, testigo] of [testigoUno, testigoDos].entries()) {
      const entrada = padron[indice]!;
      const seenAt = '2026-08-21T17:30:00.000Z';
      acuses.push({
        witness: entrada.id,
        address: entrada.address,
        seenAt,
        signature: await testigo.firmar(
          WITNESS_SIGNATURE_NAMESPACE,
          ackSignedBytes(
            ackPreimage({
              address: entrada.address,
              checkpointHash: hex,
              messageId: baseCorreo.externalRef,
              seenAt,
              witness: entrada.id,
            }),
          ),
        ),
      });
    }

    const ciclo = await runAnchorCycle({
      checkpoint: {
        treeSize: sello.treeSize,
        rootHash: sello.rootHash,
        headsRoot: sello.headsRoot,
        checkpointHash: sello.checkpointHash,
        issuedAt: sello.issuedAt,
      },
      providers: proveedores,
      ledger: anchorLedgerPort(appPool, () => requestId('ciclo-anclaje-1')),
      now: AHORA,
      existing: [reciboGit, withAcks(baseCorreo, acuses, AHORA)],
      poll: true,
    });

    expect(ciclo.verdict.firm).toBe(true);
    expect(ciclo.verdict.confirmedClasses).toStrictEqual(['blockchain', 'human-witness', 'vcs']);

    // ── 3. Persistencia de los recibos y de las cabeceras ────────────────────────────────────
    const cliente = await appPool.connect();
    try {
      for (const intento of ciclo.attempts) {
        if (intento.receipt === undefined) continue;
        await saveAnchorAttempt(cliente, {
          treeSize: sello.treeSize,
          provider: intento.provider,
          independenceClass: intento.receipt.independenceClass,
          state: intento.outcome?.status === 'confirmado' ? 'CONFIRMADO' : 'PENDIENTE',
          receipt: intento.receipt,
        });
      }
      for (const [altura, cabecera] of calendario.headers()) {
        await saveBitcoinHeader(cliente, altura, cabecera);
      }

      const releidos = await readAnchorReceipts(cliente, sello.treeSize);
      expect(releidos).toHaveLength(3);

      // ── 4. Constancia dentro del ledger ───────────────────────────────────────────────────
      const anclaje = await readStream(cliente, ANCHOR_AGGREGATE_ID);
      expect(anclaje.map((evento) => evento.event.eventType)).toStrictEqual([
        'AnclajeIntentado',
        'AnclajeConfirmado',
        'AnclajeConfirmado',
        'AnclajeConfirmado',
        'AnclajeEstadoPublicado',
      ]);
      expect(anclaje.at(-1)?.event.payload['estado']).toBe('FIRME');

      const salud = await verifyLedger(cliente);
      expect(salud.findings).toStrictEqual([]);
      expect(salud.ok).toBe(true);

      // ── 5. Export y verificación independiente ────────────────────────────────────────────
      const confianza: TrustRoster = {
        gitSigners: [{ identity: 'Veeduría 2026-2', publicKey: veeduria.publicKey }],
        witnesses: padron,
        minDistinctDomains: 2,
        forges: ['codeberg', 'github'],
        gitSigningKeyOffHost: true,
      };
      const paquete = await buildExport(cliente, { generatedAt: AHORA, trust: confianza });

      expect([...paquete.keys()]).toContain('README-VERIFICACION.txt');
      expect([...paquete.keys()]).toContain(`anchors/${String(sello.treeSize)}/ots.json`);
      expect([...paquete.keys()]).toContain(`anchors/${String(sello.treeSize)}/ots.ots`);

      const resultado = await verificarExport({
        source: memorySource('koinonia-export', paquete),
        confianza,
        ahora: AHORA,
      });

      expect(resultado.hallazgos).toStrictEqual([]);
      expect(resultado.salida).toBe(SALIDA.ok);
      expect(resultado.anclaje?.verdict.firm).toBe(true);
      expect(resultado.checkpoints).toBe(2);

      // El `.ots` crudo del paquete es el fichero real, no una envoltura nuestra: empieza por la
      // cabecera mágica de OpenTimestamps y se lo puede tragar el cliente oficial.
      const crudo = paquete.get(`anchors/${String(sello.treeSize)}/ots.ots`);
      expect(crudo).toBeInstanceOf(Uint8Array);
      expect(toHex((crudo as Uint8Array).slice(0, 15))).toBe(
        toHex(new TextEncoder().encode('\u0000OpenTimestamps')),
      );

      // ── 6. Y el ataque, contra la base real ───────────────────────────────────────────────
      // Se altera el paquete —no la base— cortándole la cola, que es lo que sólo detecta el cursor.
      const cortado = new Map(paquete);
      const eventos = String(cortado.get('events.ndjson')).split('\n');
      const hashes = String(cortado.get('events.hashes.ndjson')).split('\n');
      eventos.splice(-3, 2);
      hashes.splice(-3, 2);
      cortado.set('events.ndjson', eventos.join('\n'));
      cortado.set('events.hashes.ndjson', hashes.join('\n'));

      const manipulado = await verificarExport({
        source: memorySource('koinonia-export', cortado),
        confianza,
        ahora: AHORA,
      });
      expect(manipulado.hallazgos.map((h) => h.codigo)).toContain('COLA_TRUNCADA');
    } finally {
      cliente.release();
    }
  });

  it.skipIf(!env.ok)(
    'ERROR ENCONTRADO: con diez o más sellos, `ORDER BY tree_size` ordenaba como TEXTO',
    async () => {
      // `SELECT tree_size::text AS tree_size … ORDER BY tree_size` resuelve el ORDER BY contra la
      // columna de SALIDA, que es `text`. Con sellos 9 y 10, el «último» era el 9, y el
      // `prevCheckpoint` del siguiente habría encadenado con el equivocado: la cadena de
      // checkpoints se bifurca en silencio, que es exactamente lo que ninguna capa detecta después.
      const { appPool } = ready(env);
      const cliente = await appPool.connect();
      try {
        let ultimo = await latestCheckpoint(cliente);
        let n = 0;
        while ((ultimo?.treeSize ?? 0n) < 12n) {
          ultimo = await emitCheckpoint(appPool, {
            issuedAt: iso(20_000 + n * 1000),
            requestId: requestId(`sello-orden-${String(n)}`),
          });
          n++;
          expect(n).toBeLessThan(30);
        }

        const { rows } = await cliente.query<{ tree_size: string }>(
          'SELECT max(tree_size)::text AS tree_size FROM governance.checkpoint',
        );
        const maximoReal = BigInt(rows[0]?.tree_size ?? '0');
        expect(maximoReal).toBeGreaterThanOrEqual(12n);

        const leido = await latestCheckpoint(cliente);
        expect(leido?.treeSize).toBe(maximoReal);

        // Y la historia sigue sana tras una docena de sellos encadenados.
        const salud = await verifyLedger(cliente);
        expect(salud.findings).toStrictEqual([]);
      } finally {
        cliente.release();
      }
    },
  );

  it.skipIf(!env.ok)('un checkpoint sin anclaje queda registrado como NO ANCLADO', async () => {
    const { appPool } = ready(env);
    await append(appPool, {
      aggregateId: id32('sin-anclaje'),
      aggregateType: 'decision',
      expectedHead: { kind: 'new' },
      requestId: requestId('sin-anclaje'),
      events: [
        { eventType: 'DecisionRedactada', occurredAt: iso(9000), payload: { resumen: 'x' } },
      ],
    });
    const sello = await emitCheckpoint(appPool, {
      issuedAt: iso(9500),
      requestId: requestId('sello-3'),
    });

    const calendario = new FakeOtsCalendar();
    const ciclo = await runAnchorCycle({
      checkpoint: {
        treeSize: sello.treeSize,
        rootHash: sello.rootHash,
        headsRoot: sello.headsRoot,
        checkpointHash: sello.checkpointHash,
        issuedAt: sello.issuedAt,
      },
      providers: [new OpenTimestampsProvider({ calendar: calendario, clock: () => AHORA })],
      ledger: anchorLedgerPort(appPool, () => requestId('ciclo-sin-quorum')),
      // Cuatro días después de emitirse: pasa el umbral de las 72 h.
      now: '2026-08-25T18:00:00.000Z',
    });

    expect(ciclo.verdict.firm).toBe(false);
    expect(ciclo.verdict.state).toBe('NO_ANCLADO_CRITICO');
    expect(ciclo.verdict.decisionsPendingIntegrity).toBe(true);

    const cliente = await appPool.connect();
    try {
      const anclaje = await readStream(cliente, ANCHOR_AGGREGATE_ID);
      const ultimo = anclaje.at(-1);
      expect(ultimo?.event.eventType).toBe('AnclajeEstadoPublicado');
      expect(ultimo?.event.payload['estado']).toBe('NO_ANCLADO_CRITICO');
      expect(ultimo?.event.payload['decisionesPendientesDeIntegridad']).toBe(true);

      // Y el estado degradado vive DENTRO de la estructura protegida: ocultarlo exige alterar el
      // ledger, que es lo que el anclaje detecta.
      const actual = await latestCheckpoint(cliente);
      expect(actual?.firm).toBe(false);
    } finally {
      cliente.release();
    }
  });
});
