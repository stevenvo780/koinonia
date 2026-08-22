/**
 * Fábrica de exports: uno legítimo, y los ataques.
 *
 * ═══ Por qué se construye a mano y no se copia de `services/api` ═══
 *
 * Los exports de estos tests se construyen aquí, con las primitivas de `@koinonia/crypto` y
 * siguiendo el §2.3 y el §6.4 tal como están escritos. Si se generaran con el exportador del
 * servidor, las pruebas dirían «el verificador acepta lo que produce el exportador», que es una
 * tautología: un error compartido por los dos sería invisible. Con dos construcciones
 * independientes, que coincidan es información.
 *
 * (La otra dirección —que el exportador REAL produce algo que este verificador acepta— se prueba
 * aparte, contra PostgreSQL de verdad, en `tests/integration/export-verificable.test.ts`.)
 *
 * ═══ Los ataques ═══
 *
 * Cada ataque es lo que haría un administrador con `root`, no un byte al azar: se recalcula todo lo
 * que él podría recalcular. El objetivo de estas pruebas NO es que el verificador falle, sino que
 * falle **por el motivo correcto**. Un verificador que se pone rojo por casualidad es un verificador
 * que un día se pondrá verde por casualidad.
 */

import {
  ackPreimage,
  ackSignedBytes,
  armorSshSignature,
  buildCommitBytes,
  buildSshSignatureBlob,
  canonicalReceipt,
  checkpointBindingLine,
  commitOid,
  FakeOtsCalendar,
  OpenTimestampsProvider,
  sshPublicKeyBlob,
  sshSignedBlob,
  toBase64,
  WITNESS_SIGNATURE_NAMESPACE,
  withAcks,
  WitnessEmailProvider,
  type AnchorReceipt,
} from '@koinonia/anchor';
import {
  type CanonicalEvent,
  canonicalize,
  canonicalizeToBytes,
  concatBytes,
  DOMAIN,
  fromHex,
  hashEvent,
  type JsonObject,
  type JsonValue,
  MerkleTree,
  sha256,
  toBase64Url,
  toHex,
  zeroHash,
} from '@koinonia/crypto';
import {
  anchorReceiptPath,
  BITCOIN_HEADERS_FILE,
  CHECKPOINTS_FILE,
  consistencyProofPath,
  EVENT_HASHES_FILE,
  EVENTS_FILE,
  EXPORT_FORMAT_VERSION,
  HEADS_FILE,
  MANIFEST_FILE,
  memorySource,
  README_FILE,
  README_VERIFICACION,
  TRUST_FILE,
  type ExportSource,
  type TrustRoster,
} from '@koinonia/verificar';

const subtle = globalThis.crypto.subtle;
type Clave = Awaited<ReturnType<typeof subtle.importKey>>;

export const ESPINA = '00000000000000000000000000000001';
export const T0 = Date.UTC(2026, 7, 20, 9, 0, 0, 0);
export const AHORA = '2026-08-21T12:00:00.000Z';

export function iso(desplazamiento: number): string {
  return new Date(T0 + desplazamiento).toISOString();
}

export function id32(semilla: string): string {
  let salida = '';
  let acumulador = 0;
  for (let i = 0; i < 32; i++) {
    acumulador = (acumulador * 31 + semilla.charCodeAt(i % semilla.length) + i) >>> 0;
    salida += '0123456789abcdef'[acumulador % 16] ?? '0';
  }
  return salida;
}

export interface Registro {
  leafIndex: number;
  event: CanonicalEvent;
  prevHash: string;
  eventHash: string;
  spineHash?: string;
}

export interface Sello {
  treeSize: number;
  rootHash: string;
  headsRoot: string;
  prevCheckpoint?: string;
  issuedAt: string;
  checkpointHash: string;
}

export interface Ledger {
  registros: Registro[];
  sellos: Sello[];
  cursorNextLeafIndex: number;
  anclajes: Map<string, AnchorReceipt>;
  cabeceras: Map<number, string>;
  confianza: TrustRoster;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Construcción del ledger
// ═════════════════════════════════════════════════════════════════════════════════════════════

class Constructor {
  readonly registros: Registro[] = [];
  readonly sellos: Sello[] = [];
  readonly #cabezas = new Map<string, { seq: number; hash: string; tipo: string }>();
  #reloj = 0;

  async abrirLedger(): Promise<void> {
    const evento: CanonicalEvent = {
      aggregateId: ESPINA,
      aggregateType: '#ledger',
      seq: 0,
      eventType: 'LedgerAbierto',
      eventVersion: 1,
      occurredAt: iso(this.#reloj++ * 1000),
      payload: { vigencia: '2026_2', instituto: 'filosofia_udea' },
    };
    const prevHash = zeroHash();
    const eventHash = await hashEvent(prevHash, evento);
    this.registros.push({
      leafIndex: this.registros.length,
      event: evento,
      prevHash: toHex(prevHash),
      eventHash: toHex(eventHash),
    });
    this.#cabezas.set(ESPINA, { seq: 0, hash: toHex(eventHash), tipo: '#ledger' });
  }

  /** Abre un agregado: su génesis cuelga de la espina y la espina anota el nacimiento. */
  async abrirAgregado(
    aggregateId: string,
    aggregateType: string,
    eventType: string,
    payload: JsonObject,
  ): Promise<void> {
    const cabezaEspina = this.#cabezas.get(ESPINA);
    if (cabezaEspina === undefined) throw new Error('la espina no está abierta');
    const anclaEspina = cabezaEspina.hash;

    const genesis: CanonicalEvent = {
      aggregateId,
      aggregateType,
      seq: 0,
      eventType,
      eventVersion: 1,
      occurredAt: iso(this.#reloj++ * 1000),
      payload,
    };
    const genesisHash = await hashEvent(fromHex(anclaEspina), genesis);
    this.registros.push({
      leafIndex: this.registros.length,
      event: genesis,
      prevHash: anclaEspina,
      eventHash: toHex(genesisHash),
      spineHash: anclaEspina,
    });
    this.#cabezas.set(aggregateId, { seq: 0, hash: toHex(genesisHash), tipo: aggregateType });

    // El vínculo hacia adelante. Comparte padre con el génesis: los dos cuelgan de la misma cabeza
    // de la espina, y sólo el de la espina menciona al otro. No hay circularidad.
    const anotacion: CanonicalEvent = {
      aggregateId: ESPINA,
      aggregateType: '#ledger',
      seq: cabezaEspina.seq + 1,
      eventType: 'AgregadoAbierto',
      eventVersion: 1,
      occurredAt: genesis.occurredAt,
      payload: { aggregateId, aggregateType, genesisHash: toHex(genesisHash) },
    };
    const anotacionHash = await hashEvent(fromHex(anclaEspina), anotacion);
    this.registros.push({
      leafIndex: this.registros.length,
      event: anotacion,
      prevHash: anclaEspina,
      eventHash: toHex(anotacionHash),
    });
    this.#cabezas.set(ESPINA, {
      seq: anotacion.seq,
      hash: toHex(anotacionHash),
      tipo: '#ledger',
    });
  }

  async anadir(aggregateId: string, eventType: string, payload: JsonObject): Promise<void> {
    const cabeza = this.#cabezas.get(aggregateId);
    if (cabeza === undefined) throw new Error(`${aggregateId} no existe`);
    const evento: CanonicalEvent = {
      aggregateId,
      aggregateType: cabeza.tipo,
      seq: cabeza.seq + 1,
      eventType,
      eventVersion: 1,
      occurredAt: iso(this.#reloj++ * 1000),
      payload,
    };
    const eventHash = await hashEvent(fromHex(cabeza.hash), evento);
    this.registros.push({
      leafIndex: this.registros.length,
      event: evento,
      prevHash: cabeza.hash,
      eventHash: toHex(eventHash),
    });
    this.#cabezas.set(aggregateId, { seq: evento.seq, hash: toHex(eventHash), tipo: cabeza.tipo });
  }

  /**
   * Emite un sello y lo anota en la espina.
   *
   * El `CheckpointEmitido` cae en `leaf_index = treeSize`, es decir **dentro del siguiente sello**:
   * el log se compromete recursivamente con su propia historia de publicaciones.
   */
  async emitirSello(): Promise<void> {
    const treeSize = this.registros.length;
    const rootHash = toHex(
      (await MerkleTree.build(this.registros.map((r) => fromHex(r.eventHash)))).root(),
    );
    const headsRoot = toHex(await raizDeCabezas(this.registros));
    const previo = this.sellos.at(-1);
    const issuedAt = iso(this.#reloj++ * 1000);

    const preimagen: JsonObject = {
      treeSize,
      rootHash,
      headsRoot,
      ...(previo === undefined ? {} : { prevCheckpoint: previo.checkpointHash }),
      issuedAt,
    };
    const checkpointHash = toHex(
      await sha256(concatBytes(Uint8Array.of(DOMAIN.checkpoint), canonicalizeToBytes(preimagen))),
    );

    this.sellos.push({
      treeSize,
      rootHash,
      headsRoot,
      ...(previo === undefined ? {} : { prevCheckpoint: previo.checkpointHash }),
      issuedAt,
      checkpointHash,
    });

    const cabezaEspina = this.#cabezas.get(ESPINA);
    if (cabezaEspina === undefined) throw new Error('la espina no está abierta');
    const evento: CanonicalEvent = {
      aggregateId: ESPINA,
      aggregateType: '#ledger',
      seq: cabezaEspina.seq + 1,
      eventType: 'CheckpointEmitido',
      eventVersion: 1,
      occurredAt: issuedAt,
      payload: { treeSize, rootHash, checkpointHash },
    };
    const eventHash = await hashEvent(fromHex(cabezaEspina.hash), evento);
    this.registros.push({
      leafIndex: this.registros.length,
      event: evento,
      prevHash: cabezaEspina.hash,
      eventHash: toHex(eventHash),
    });
    this.#cabezas.set(ESPINA, { seq: evento.seq, hash: toHex(eventHash), tipo: '#ledger' });
  }
}

export async function raizDeCabezas(prefijo: readonly Registro[]): Promise<Uint8Array> {
  const cabezas = new Map<string, { seq: number; hash: string }>();
  for (const registro of prefijo) {
    cabezas.set(registro.event.aggregateId, {
      seq: registro.event.seq,
      hash: registro.eventHash,
    });
  }
  const entradas = [...cabezas]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([aggregateId, cabeza]) => {
      const seq = new Uint8Array(8);
      new DataView(seq.buffer).setBigInt64(0, BigInt(cabeza.seq), false);
      return concatBytes(fromHex(aggregateId), seq, fromHex(cabeza.hash));
    });
  return (await MerkleTree.build(entradas)).root();
}

export const DECISION_A = id32('decision-acta-marzo');
export const DECISION_B = id32('decision-presupuesto');
export const DECISION_C = id32('decision-horarios');

export interface OpcionesLedger {
  /** Texto del resumen de la primera decisión. Cambiarlo es «reescribir el pasado». */
  readonly resumenA?: string;
  /** Identidades opcionales para probar la regla global sin reutilizar código del servidor. */
  readonly eventIdA?: string;
  readonly eventIdB?: string;
}

/** Un ledger pequeño pero realista: espina, dos expedientes y dos sellos. */
export async function construirLedger(opciones: OpcionesLedger = {}): Promise<Ledger> {
  const constructor = new Constructor();
  await constructor.abrirLedger();

  await constructor.abrirAgregado(DECISION_A, 'decision', 'DecisionRedactada', {
    ...(opciones.eventIdA === undefined ? {} : { eventId: opciones.eventIdA }),
    resumen: opciones.resumenA ?? 'Aprobar el acta de la asamblea del 3 de marzo',
  });
  await constructor.anadir(DECISION_A, 'DecisionAbierta', { ronda: 1 });
  await constructor.anadir(DECISION_A, 'PapeletaEmitida', { votante: id32('ana'), voto: 'si' });
  await constructor.anadir(DECISION_A, 'PapeletaEmitida', { votante: id32('bruno'), voto: 'no' });

  await constructor.emitirSello();

  await constructor.abrirAgregado(DECISION_B, 'decision', 'DecisionRedactada', {
    ...(opciones.eventIdB === undefined ? {} : { eventId: opciones.eventIdB }),
    resumen: 'Repartir el presupuesto de eventos del semestre',
  });
  await constructor.anadir(DECISION_B, 'DecisionAbierta', { ronda: 1 });
  await constructor.anadir(DECISION_A, 'DecisionCerrada', { causa: 'ventana' });

  await constructor.emitirSello();

  // Todo lo que sigue queda FUERA del último sello. Es la «ventana de alterabilidad» del §8: lo
  // ocurrido desde la última raíz anclada. Existe en la fábrica a propósito, porque es donde viven
  // dos de los ataques (el truncamiento de la cola y el borrado de un expediente entero) y donde se
  // ve que la espina y el cursor detectan lo que los sellos todavía no cubren.
  await constructor.abrirAgregado(DECISION_C, 'decision', 'DecisionRedactada', {
    resumen: 'Cambiar el horario de la asamblea ordinaria',
  });
  await constructor.anadir(DECISION_C, 'DecisionAbierta', { ronda: 1 });
  await constructor.anadir(DECISION_B, 'PapeletaEmitida', { votante: id32('carla'), voto: 'si' });
  await constructor.anadir(DECISION_B, 'PapeletaEmitida', { votante: id32('dario'), voto: 'no' });

  return {
    registros: constructor.registros,
    sellos: constructor.sellos,
    cursorNextLeafIndex: constructor.registros.length,
    anclajes: new Map(),
    cabeceras: new Map(),
    confianza: {
      gitSigners: [],
      witnesses: [],
      minDistinctDomains: 1,
      forges: ['codeberg', 'github'],
      gitSigningKeyOffHost: true,
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Anclajes
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface Firmante {
  readonly publicKey: string;
  firmar(namespace: string, message: Uint8Array): Promise<string>;
}

export async function nuevoFirmante(): Promise<Firmante> {
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

/** Ancla el último sello con las tres clases de independencia. */
export async function anclar(ledger: Ledger): Promise<Ledger> {
  const sello = ledger.sellos.at(-1);
  if (sello === undefined) throw new Error('no hay sello que anclar');
  const checkpointHash = fromHex(sello.checkpointHash);

  // (1) Bitcoin, vía OpenTimestamps, con la cabecera del bloque publicada en el propio paquete.
  const calendario = new FakeOtsCalendar({ firstHeight: 921_447, firstBlockTime: 1_787_100_000 });
  const ots = new OpenTimestampsProvider({ calendar: calendario, clock: () => AHORA });
  const reciboOts = await ots.poll(await ots.submit(checkpointHash));
  const cabeceras = new Map<number, string>();
  for (const [altura, cabecera] of calendario.headers()) cabeceras.set(altura, toHex(cabecera));

  // (2) Commit firmado por la veeduría, con la clave fuera de este servidor.
  const veeduria = await nuevoFirmante();
  const mensaje = [
    `Checkpoint ${String(sello.treeSize)}`,
    '',
    checkpointBindingLine(sello.checkpointHash),
    '',
  ].join('\n');
  const autor = 'Veeduria <veeduria@ejemplo.org> 1787100000 +0000';
  const base = {
    tree: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    author: autor,
    committer: autor,
    message: mensaje,
  };
  const armadura = await veeduria.firmar('git', buildCommitBytes(base));
  const objeto = buildCommitBytes({ ...base, signature: armadura });
  const reciboGit: AnchorReceipt = {
    provider: 'git',
    independenceClass: 'vcs',
    checkpointHash: sello.checkpointHash,
    externalRef: await commitOid(objeto),
    submittedAt: AHORA,
    confirmedAt: AHORA,
    proof: toBase64Url(objeto),
    raw: { forgesSeen: ['codeberg', 'github'] },
  };

  // (3) Testigos por correo, con acuses firmados por ellos.
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
  const baseCorreo = await correo.submit(checkpointHash);
  const acuses = [];
  for (const [indice, testigo] of [testigoUno, testigoDos].entries()) {
    const entrada = padron[indice]!;
    const seenAt = '2026-08-21T11:30:00.000Z';
    const firma = await testigo.firmar(
      WITNESS_SIGNATURE_NAMESPACE,
      ackSignedBytes(
        ackPreimage({
          address: entrada.address,
          checkpointHash: sello.checkpointHash,
          messageId: baseCorreo.externalRef,
          seenAt,
          witness: entrada.id,
        }),
      ),
    );
    acuses.push({ witness: entrada.id, address: entrada.address, seenAt, signature: firma });
  }
  const reciboCorreo = withAcks(baseCorreo, acuses, AHORA);

  return {
    ...ledger,
    cabeceras,
    anclajes: new Map([
      ['ots', reciboOts],
      ['git', reciboGit],
      ['correo', reciboCorreo],
    ]),
    confianza: {
      gitSigners: [{ identity: 'Veeduría 2026-2', publicKey: veeduria.publicKey }],
      witnesses: padron,
      minDistinctDomains: 2,
      forges: ['codeberg', 'github'],
      gitSigningKeyOffHost: true,
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Render del export
// ═════════════════════════════════════════════════════════════════════════════════════════════

export async function renderExport(ledger: Ledger): Promise<Map<string, string>> {
  const ficheros = new Map<string, string>();

  ficheros.set(
    EVENTS_FILE,
    terminar(ledger.registros.map((registro) => canonicalize(registro.event))),
  );
  ficheros.set(
    EVENT_HASHES_FILE,
    terminar(
      ledger.registros.map((registro) =>
        canonicalize({
          leafIndex: registro.leafIndex,
          eventHash: registro.eventHash,
          prevHash: registro.prevHash,
          ...(registro.spineHash === undefined ? {} : { spineHash: registro.spineHash }),
        }),
      ),
    ),
  );

  const cabezas = new Map<string, { seq: number; hash: string; tipo: string }>();
  for (const registro of ledger.registros) {
    cabezas.set(registro.event.aggregateId, {
      seq: registro.event.seq,
      hash: registro.eventHash,
      tipo: registro.event.aggregateType,
    });
  }
  ficheros.set(
    HEADS_FILE,
    `${canonicalize({
      heads: [...cabezas]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([aggregateId, cabeza]) => ({
          aggregateId,
          aggregateType: cabeza.tipo,
          seq: cabeza.seq,
          headHash: cabeza.hash,
        })),
    })}\n`,
  );

  ficheros.set(
    CHECKPOINTS_FILE,
    terminar(
      ledger.sellos.map((sello) =>
        canonicalize({
          treeSize: sello.treeSize,
          rootHash: sello.rootHash,
          headsRoot: sello.headsRoot,
          ...(sello.prevCheckpoint === undefined ? {} : { prevCheckpoint: sello.prevCheckpoint }),
          issuedAt: sello.issuedAt,
          checkpointHash: sello.checkpointHash,
        }),
      ),
    ),
  );

  for (let i = 1; i < ledger.sellos.length; i++) {
    const anterior = ledger.sellos[i - 1]!;
    const actual = ledger.sellos[i]!;
    if (actual.treeSize > ledger.registros.length) continue;
    const arbol = await MerkleTree.build(
      ledger.registros.slice(0, actual.treeSize).map((r) => fromHex(r.eventHash)),
    );
    ficheros.set(
      consistencyProofPath(anterior.treeSize, actual.treeSize),
      `${canonicalize({
        from: anterior.treeSize,
        to: actual.treeSize,
        proof: arbol.consistencyProof(anterior.treeSize).map(toHex),
      })}\n`,
    );
  }

  const ultimo = ledger.sellos.at(-1);
  if (ultimo !== undefined) {
    for (const [proveedor, recibo] of ledger.anclajes) {
      ficheros.set(anchorReceiptPath(ultimo.treeSize, proveedor), `${canonicalReceipt(recibo)}\n`);
    }
  }
  if (ledger.cabeceras.size > 0) {
    ficheros.set(
      BITCOIN_HEADERS_FILE,
      `${canonicalize({
        headers: [...ledger.cabeceras]
          .sort(([a], [b]) => a - b)
          .map(([height, header]) => ({ height, header })),
      })}\n`,
    );
  }

  ficheros.set(TRUST_FILE, `${canonicalize(rosterAJson(ledger.confianza))}\n`);
  ficheros.set(README_FILE, README_VERIFICACION);

  const codificador = new TextEncoder();
  const entradas: { path: string; sha256: string }[] = [];
  for (const [ruta, contenido] of [...ficheros].sort(([a], [b]) => (a < b ? -1 : 1))) {
    entradas.push({ path: ruta, sha256: toHex(await sha256(codificador.encode(contenido))) });
  }

  const ultimoRegistro = ledger.registros.at(-1);
  ficheros.set(
    MANIFEST_FILE,
    `${canonicalize({
      formatVersion: EXPORT_FORMAT_VERSION,
      generatedAt: AHORA,
      eventCount: ledger.registros.length,
      ...(ultimoRegistro === undefined ? {} : { lastLeafIndex: ultimoRegistro.leafIndex }),
      cursorNextLeafIndex: ledger.cursorNextLeafIndex,
      spineAggregateId: ESPINA,
      algorithms: {
        hash: 'SHA-256',
        canonicalization: 'RFC 8785 (JCS)',
        merkle: 'RFC 6962',
        signature: 'Ed25519 (SSHSIG)',
      },
      files: entradas,
    })}\n`,
  );

  return ficheros;
}

export async function fuenteDe(ledger: Ledger, nombre = 'koinonia-export'): Promise<ExportSource> {
  return memorySource(nombre, await renderExport(ledger));
}

function rosterAJson(trust: TrustRoster): Record<string, JsonValue> {
  return {
    forges: [...trust.forges],
    gitSigners: trust.gitSigners.map((f) => ({ identity: f.identity, publicKey: f.publicKey })),
    gitSigningKeyOffHost: trust.gitSigningKeyOffHost,
    minDistinctDomains: trust.minDistinctDomains,
    witnesses: trust.witnesses.map((t) => ({
      id: t.id,
      address: t.address,
      publicKey: t.publicKey,
    })),
  };
}

function terminar(lineas: readonly string[]): string {
  return lineas.length === 0 ? '' : `${lineas.join('\n')}\n`;
}
