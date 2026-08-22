/**
 * Formato binario de OpenTimestamps: serialización, deserialización y recorrido **offline**.
 *
 * Esto no es una maqueta: es el formato real de un fichero `.ots` detached, tal como lo escribe
 * `python-opentimestamps` y tal como lo lee el cliente oficial. Se implementa aquí, byte a byte,
 * por una razón concreta: el valor entero de un sello OpenTimestamps es que **cualquiera** pueda
 * comprobarlo por su cuenta, y eso exige que el fichero que publicamos sea el fichero de verdad y
 * no un JSON nuestro que sólo entiende nuestro código. Quien desconfíe de este paquete puede coger
 * el `.ots` del export y pasárselo al cliente oficial de OpenTimestamps.
 *
 * ═══ Estructura ═══
 *
 *     HEADER_MAGIC (31 B) ‖ varuint(versión mayor) ‖ tag(op de hash del fichero) ‖ digest ‖ sello
 *
 * y un «sello» es un árbol: desde un mensaje se aplican operaciones (`append`, `prepend`, `sha256`)
 * que producen mensajes nuevos, y las hojas del árbol son **atestaciones**: o bien `pending` («un
 * calendario público se comprometió a incluirlo»), o bien `bitcoin` («el resultado de este camino
 * ES la raíz de Merkle del bloque N»).
 *
 * ═══ Qué se puede verificar sin red y qué no ═══
 *
 * Recorrer el árbol y comprobar que el camino **parte de nuestro hash y llega al digest que la
 * atestación afirma** es aritmética pura: no necesita red y aquí se hace entera. Lo que no se puede
 * cerrar sin un dato externo es la última afirmación: «el bloque 921 447 de Bitcoin tiene esa raíz
 * de Merkle». Ese dato son 80 bytes —la cabecera del bloque— y el verificador los acepta de fuera
 * (del export, de un fichero local, de un nodo propio). Si no los tiene, dice `incompleto` y nombra
 * la afirmación que falta. Nunca la da por buena.
 */

import { sha256, toHex } from '@koinonia/crypto';

/** `b'\x00' + b'OpenTimestamps' + b'\x00' + b'\x00Proof' + b'\x00' + b'\xbf\x89\xe2\xe8\x84\xe8\x92\x94'` */
export const OTS_HEADER_MAGIC: Uint8Array = Uint8Array.from([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);

export const OTS_MAJOR_VERSION = 1;

/** Etiquetas de operación (`opentimestamps/core/op.py`). */
export const OTS_OP_TAG = {
  sha1: 0x02,
  ripemd160: 0x03,
  sha256: 0x08,
  keccak256: 0x67,
  append: 0xf0,
  prepend: 0xf1,
  reverse: 0xf2,
  hexlify: 0xf3,
} as const;

/** Etiquetas de atestación, 8 bytes cada una (`opentimestamps/core/notary.py`). */
export const OTS_ATTESTATION_TAG = {
  pending: Uint8Array.from([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]),
  bitcoin: Uint8Array.from([0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01]),
  litecoin: Uint8Array.from([0x06, 0x86, 0x9a, 0x0d, 0x73, 0xd7, 0x1b, 0x45]),
  ethereum: Uint8Array.from([0x30, 0xfe, 0x80, 0x87, 0xb5, 0xc7, 0xea, 0xd7]),
} as const;

const MAX_PAYLOAD = 8192;
/** Cota de recursión del árbol del sello. Un `.ots` hostil no puede hacer explotar la pila. */
const MAX_DEPTH = 256;

export class OtsFormatError extends Error {
  constructor(detail: string) {
    super(`fichero .ots ilegible: ${detail}`);
    this.name = 'OtsFormatError';
  }
}

export type OtsOp =
  | { readonly kind: 'sha1' }
  | { readonly kind: 'ripemd160' }
  | { readonly kind: 'sha256' }
  | { readonly kind: 'keccak256' }
  | { readonly kind: 'reverse' }
  | { readonly kind: 'hexlify' }
  | { readonly kind: 'append'; readonly argument: Uint8Array }
  | { readonly kind: 'prepend'; readonly argument: Uint8Array };

export type OtsAttestation =
  | { readonly kind: 'pending'; readonly uri: string }
  | { readonly kind: 'bitcoin'; readonly height: number }
  | { readonly kind: 'litecoin'; readonly height: number }
  | { readonly kind: 'ethereum'; readonly height: number }
  | { readonly kind: 'unknown'; readonly tag: Uint8Array; readonly payload: Uint8Array };

export interface OtsTimestamp {
  /** Mensaje del que cuelga este nodo. Derivado, no serializado. */
  readonly msg: Uint8Array;
  readonly attestations: readonly OtsAttestation[];
  readonly ops: readonly OtsBranch[];
}

export interface OtsBranch {
  readonly op: OtsOp;
  readonly timestamp: OtsTimestamp;
}

export interface DetachedTimestamp {
  readonly majorVersion: number;
  /** Operación con la que se resumió el fichero sellado. En la práctica, `sha256`. */
  readonly fileHashOp: OtsOp;
  /** Digest del fichero sellado: el `msg` raíz del sello. */
  readonly fileDigest: Uint8Array;
  readonly timestamp: OtsTimestamp;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lectura
// ═════════════════════════════════════════════════════════════════════════════════════════════

class Reader {
  readonly #bytes: Uint8Array;
  #offset = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  get offset(): number {
    return this.#offset;
  }

  readBytes(n: number): Uint8Array {
    if (n < 0 || this.#offset + n > this.#bytes.length) {
      throw new OtsFormatError(
        `se pidieron ${String(n)} bytes en el desplazamiento ${String(this.#offset)} y sólo hay ` +
          String(this.#bytes.length - this.#offset),
      );
    }
    const out = this.#bytes.slice(this.#offset, this.#offset + n);
    this.#offset += n;
    return out;
  }

  readByte(): number {
    const b = this.readBytes(1)[0];
    if (b === undefined) throw new OtsFormatError('fin de fichero inesperado');
    return b;
  }

  /** Entero de longitud variable base-128, poco significativo primero. */
  readVaruint(): number {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = this.readByte();
      if (shift > 49) throw new OtsFormatError('varuint fuera del rango entero seguro');
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    if (!Number.isSafeInteger(value)) throw new OtsFormatError('varuint no representable');
    return value;
  }

  readVarbytes(max = MAX_PAYLOAD): Uint8Array {
    const length = this.readVaruint();
    if (length > max) throw new OtsFormatError(`varbytes de ${String(length)} B excede el máximo`);
    return this.readBytes(length);
  }

  assertMagic(magic: Uint8Array): void {
    const actual = this.readBytes(magic.length);
    for (let i = 0; i < magic.length; i++) {
      if (actual[i] !== magic[i]) {
        throw new OtsFormatError('la cabecera no es la de un fichero .ots (magic incorrecto)');
      }
    }
  }

  assertEof(): void {
    if (this.#offset !== this.#bytes.length) {
      throw new OtsFormatError(
        `sobran ${String(this.#bytes.length - this.#offset)} bytes al final del fichero`,
      );
    }
  }
}

class Writer {
  readonly #chunks: number[] = [];

  writeBytes(bytes: Uint8Array): void {
    for (const byte of bytes) this.#chunks.push(byte);
  }

  writeByte(byte: number): void {
    this.#chunks.push(byte & 0xff);
  }

  writeVaruint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new OtsFormatError(`varuint inválido: ${String(value)}`);
    }
    let rest = value;
    if (rest === 0) {
      this.#chunks.push(0);
      return;
    }
    while (rest !== 0) {
      const byte = rest % 128;
      rest = Math.floor(rest / 128);
      this.#chunks.push(rest !== 0 ? byte | 0x80 : byte);
    }
  }

  writeVarbytes(bytes: Uint8Array): void {
    this.writeVaruint(bytes.length);
    this.writeBytes(bytes);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.#chunks);
  }
}

function opFromTag(tag: number, reader: Reader): OtsOp {
  switch (tag) {
    case OTS_OP_TAG.sha1:
      return { kind: 'sha1' };
    case OTS_OP_TAG.ripemd160:
      return { kind: 'ripemd160' };
    case OTS_OP_TAG.sha256:
      return { kind: 'sha256' };
    case OTS_OP_TAG.keccak256:
      return { kind: 'keccak256' };
    case OTS_OP_TAG.reverse:
      return { kind: 'reverse' };
    case OTS_OP_TAG.hexlify:
      return { kind: 'hexlify' };
    case OTS_OP_TAG.append:
      return { kind: 'append', argument: reader.readVarbytes() };
    case OTS_OP_TAG.prepend:
      return { kind: 'prepend', argument: reader.readVarbytes() };
    default:
      throw new OtsFormatError(`operación desconocida 0x${tag.toString(16).padStart(2, '0')}`);
  }
}

function writeOp(writer: Writer, op: OtsOp): void {
  switch (op.kind) {
    case 'append':
      writer.writeByte(OTS_OP_TAG.append);
      writer.writeVarbytes(op.argument);
      return;
    case 'prepend':
      writer.writeByte(OTS_OP_TAG.prepend);
      writer.writeVarbytes(op.argument);
      return;
    default:
      writer.writeByte(OTS_OP_TAG[op.kind]);
      return;
  }
}

/** Longitud del digest de cada operación de resumen, para leer el `fileDigest`. */
export function digestLength(op: OtsOp): number {
  switch (op.kind) {
    case 'sha1':
      return 20;
    case 'ripemd160':
      return 20;
    case 'sha256':
      return 32;
    case 'keccak256':
      return 32;
    default:
      throw new OtsFormatError(`${op.kind} no es una operación de resumen`);
  }
}

/**
 * Aplica una operación. `ripemd160` y `keccak256` **no** están implementadas a propósito: WebCrypto
 * no las trae, y meter una implementación propia de una primitiva criptográfica para un camino que
 * los calendarios de Bitcoin no usan sería añadir superficie de ataque a cambio de nada. Si algún
 * día aparece un sello que las use, el verificador lo dice con estas palabras en vez de fingir.
 */
export async function applyOp(op: OtsOp, msg: Uint8Array): Promise<Uint8Array> {
  switch (op.kind) {
    case 'sha256':
      return sha256(msg);
    case 'sha1': {
      const subtle = globalThis.crypto.subtle;
      return new Uint8Array(await subtle.digest('SHA-1', msg));
    }
    case 'append': {
      const out = new Uint8Array(msg.length + op.argument.length);
      out.set(msg, 0);
      out.set(op.argument, msg.length);
      return out;
    }
    case 'prepend': {
      const out = new Uint8Array(op.argument.length + msg.length);
      out.set(op.argument, 0);
      out.set(msg, op.argument.length);
      return out;
    }
    case 'reverse':
      return Uint8Array.from([...msg].reverse());
    case 'hexlify':
      // `toHex` ya produce [0-9a-f] en minúscula, que es lo que hexlify define; los caracteres son
      // ASCII, así que UTF-8 y ASCII coinciden byte a byte.
      return new TextEncoder().encode(toHex(msg));
    case 'ripemd160':
    case 'keccak256':
      throw new OtsFormatError(
        `el sello usa ${op.kind}, que este verificador no implementa; comprobalo con el cliente ` +
          'oficial de OpenTimestamps',
      );
    default:
      throw new OtsFormatError('operación no contemplada');
  }
}

function readAttestation(reader: Reader): OtsAttestation {
  const tag = reader.readBytes(8);
  const payload = reader.readVarbytes();
  const inner = new Reader(payload);
  const matches = (expected: Uint8Array): boolean => tag.every((b, i) => b === expected[i]);

  if (matches(OTS_ATTESTATION_TAG.pending)) {
    const uri = new TextDecoder('utf-8', { fatal: true }).decode(inner.readVarbytes(1000));
    return { kind: 'pending', uri };
  }
  if (matches(OTS_ATTESTATION_TAG.bitcoin)) return { kind: 'bitcoin', height: inner.readVaruint() };
  if (matches(OTS_ATTESTATION_TAG.litecoin)) {
    return { kind: 'litecoin', height: inner.readVaruint() };
  }
  if (matches(OTS_ATTESTATION_TAG.ethereum)) {
    return { kind: 'ethereum', height: inner.readVaruint() };
  }
  return { kind: 'unknown', tag, payload };
}

function writeAttestation(writer: Writer, attestation: OtsAttestation): void {
  const payload = new Writer();
  switch (attestation.kind) {
    case 'pending':
      writer.writeBytes(OTS_ATTESTATION_TAG.pending);
      payload.writeVarbytes(new TextEncoder().encode(attestation.uri));
      break;
    case 'bitcoin':
      writer.writeBytes(OTS_ATTESTATION_TAG.bitcoin);
      payload.writeVaruint(attestation.height);
      break;
    case 'litecoin':
      writer.writeBytes(OTS_ATTESTATION_TAG.litecoin);
      payload.writeVaruint(attestation.height);
      break;
    case 'ethereum':
      writer.writeBytes(OTS_ATTESTATION_TAG.ethereum);
      payload.writeVaruint(attestation.height);
      break;
    case 'unknown':
      writer.writeBytes(attestation.tag);
      payload.writeBytes(attestation.payload);
      break;
    default:
      throw new OtsFormatError('atestación no contemplada');
  }
  writer.writeVarbytes(payload.finish());
}

async function readTimestamp(
  reader: Reader,
  msg: Uint8Array,
  depth: number,
): Promise<OtsTimestamp> {
  if (depth > MAX_DEPTH)
    throw new OtsFormatError('el árbol del sello excede la profundidad máxima');

  const attestations: OtsAttestation[] = [];
  const ops: OtsBranch[] = [];

  const consume = async (tag: number): Promise<void> => {
    if (tag === 0x00) {
      attestations.push(readAttestation(reader));
      return;
    }
    const op = opFromTag(tag, reader);
    const childMsg = await applyOp(op, msg);
    ops.push({ op, timestamp: await readTimestamp(reader, childMsg, depth + 1) });
  };

  let tag = reader.readByte();
  while (tag === 0xff) {
    await consume(reader.readByte());
    tag = reader.readByte();
  }
  await consume(tag);

  return { msg, attestations, ops };
}

function writeTimestamp(writer: Writer, timestamp: OtsTimestamp): void {
  const { attestations, ops } = timestamp;
  const total = attestations.length + ops.length;
  if (total === 0) {
    throw new OtsFormatError('un sello sin operaciones ni atestaciones no es serializable');
  }

  // `\xff` significa «detrás de esto viene otra cosa **en este mismo nodo**»: lo lleva todo menos el
  // último elemento, sea atestación o rama. La convención es la de `python-opentimestamps`, y
  // respetarla es lo que permite que el cliente oficial lea nuestros ficheros.
  //
  // ERRATA (hallada por una prueba, 2026-08-22): la versión anterior contaba las atestaciones y las
  // ramas por separado y escribía la **última atestación** sin `\xff`, aunque después vinieran ramas.
  // Un nodo con atestación Y ramas —que es exactamente lo que produce fusionar un sello pendiente
  // con su versión madurada— se serializaba en un fichero que ya no se podía volver a leer: el
  // lector daba el nodo por terminado y los bytes de las ramas sobraban al final. El error no se
  // notaba porque hasta ahora ningún nodo tenía las dos cosas.
  let escritos = 0;

  for (const attestation of attestations) {
    escritos++;
    if (escritos < total) writer.writeByte(0xff);
    writer.writeByte(0x00);
    writeAttestation(writer, attestation);
  }

  for (const branch of ops) {
    escritos++;
    if (escritos < total) writer.writeByte(0xff);
    writeOp(writer, branch.op);
    writeTimestamp(writer, branch.timestamp);
  }
}

export async function parseDetachedTimestamp(bytes: Uint8Array): Promise<DetachedTimestamp> {
  const reader = new Reader(bytes);
  reader.assertMagic(OTS_HEADER_MAGIC);
  const majorVersion = reader.readVaruint();
  if (majorVersion !== OTS_MAJOR_VERSION) {
    throw new OtsFormatError(`versión mayor ${String(majorVersion)} desconocida`);
  }
  const fileHashOp = opFromTag(reader.readByte(), reader);
  const fileDigest = reader.readBytes(digestLength(fileHashOp));
  const timestamp = await readTimestamp(reader, fileDigest, 0);
  reader.assertEof();
  return { majorVersion, fileHashOp, fileDigest, timestamp };
}

/**
 * Parsea un `Timestamp` **suelto** —sin cabecera mágica ni digest— dado el mensaje del que cuelga.
 * Es exactamente lo que devuelve un calendario en `POST /digest`: el calendario ya sabe qué digest
 * le mandamos, así que no lo repite.
 */
export async function parseBareTimestamp(
  msg: Uint8Array,
  bytes: Uint8Array,
): Promise<OtsTimestamp> {
  const reader = new Reader(bytes);
  const timestamp = await readTimestamp(reader, msg, 0);
  reader.assertEof();
  return timestamp;
}

export function serializeDetachedTimestamp(detached: DetachedTimestamp): Uint8Array {
  const writer = new Writer();
  writer.writeBytes(OTS_HEADER_MAGIC);
  writer.writeVaruint(detached.majorVersion);
  writeOp(writer, detached.fileHashOp);
  writer.writeBytes(detached.fileDigest);
  writeTimestamp(writer, detached.timestamp);
  return writer.finish();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Recorrido
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Una hoja del árbol: qué afirma y con qué digest se cierra el camino que lleva hasta ella. */
export interface OtsLeaf {
  readonly attestation: OtsAttestation;
  /** Resultado de aplicar todas las operaciones del camino desde el `fileDigest`. */
  readonly digest: Uint8Array;
  /** Las operaciones recorridas, para poder explicar el camino en prosa. */
  readonly path: readonly OtsOp[];
}

/**
 * Recorre el árbol y devuelve todas las hojas con el digest exacto al que llega cada camino.
 * Es pura aritmética sobre los bytes del recibo: **no necesita red**.
 */
export function walk(timestamp: OtsTimestamp): OtsLeaf[] {
  const out: OtsLeaf[] = [];
  const visit = (node: OtsTimestamp, path: readonly OtsOp[]): void => {
    for (const attestation of node.attestations) {
      out.push({ attestation, digest: node.msg, path });
    }
    for (const branch of node.ops) visit(branch.timestamp, [...path, branch.op]);
  };
  visit(timestamp, []);
  return out;
}
