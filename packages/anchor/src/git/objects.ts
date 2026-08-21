/**
 * Objetos de git y firmas SSH, verificables **sin git y sin red**.
 *
 * Dos formatos y nada más:
 *
 *  1. **El objeto commit.** Cabeceras (`tree`, `parent`, `author`, `committer`, `gpgsig`), línea en
 *     blanco, mensaje. Su identificador es `SHA1("commit " ‖ longitud ‖ 0x00 ‖ bytes)`. Recalcularlo
 *     es lo que impide que alguien nos dé un commit distinto del que dice.
 *
 *  2. **`SSHSIG`** (PROTOCOL.sshsig de OpenSSH), que es lo que produce `git commit -S` cuando
 *     `gpg.format = ssh`.
 *
 * DECISIÓN: la spec (§8.2) dice «clave GPG». Aquí se implementa la **firma SSH**, que git admite
 * desde 2.34 y que produce exactamente la misma garantía. Motivo: verificar OpenPGP obliga a parsear
 * paquetes, subclaves, autofirmas, revocaciones y caducidades —un formato que ha generado
 * vulnerabilidades de análisis durante treinta años— mientras que `SSHSIG` sobre Ed25519 son cuatro
 * cadenas con longitud y una verificación que WebCrypto hace nativa. Un verificador que la asamblea
 * pueda leer entero en una tarde vale más que uno que soporte OpenPGP y que nadie audite. La forma
 * del recibo no cambia si algún día se añade OpenPGP: sería otro `algorithm`.
 */

import { fromBase64, toBase64 } from '../base64.js';

const UTF8 = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: true });

export class GitFormatError extends Error {
  constructor(detail: string) {
    super(`objeto de git ilegible: ${detail}`);
    this.name = 'GitFormatError';
  }
}

export class SshSigError extends Error {
  constructor(detail: string) {
    super(`firma SSH ilegible: ${detail}`);
    this.name = 'SshSigError';
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Commit
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface GitCommit {
  /** Bytes exactos del objeto, tal como los guarda git (sin la cabecera `commit <len>\0`). */
  readonly bytes: Uint8Array;
  readonly tree: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly committer: string;
  /** Firma en armadura, si la hay. */
  readonly signature: string | undefined;
  /** Nombre de la cabecera que llevaba la firma (`gpgsig`). */
  readonly signatureHeader: string | undefined;
  /** Los bytes que se firmaron: el objeto SIN la cabecera de firma. */
  readonly signedPayload: Uint8Array;
  readonly message: string;
}

/** `SHA1("commit " ‖ longitud ‖ 0x00 ‖ bytes)`, en 40 hex. Es el identificador del commit. */
export async function commitOid(bytes: Uint8Array): Promise<string> {
  const prefix = UTF8.encode(`commit ${String(bytes.length)}\0`);
  const framed = new Uint8Array(prefix.length + bytes.length);
  framed.set(prefix, 0);
  framed.set(bytes, prefix.length);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', framed));
  let out = '';
  for (const byte of digest) out += byte.toString(16).padStart(2, '0');
  return out;
}

const SIGNATURE_HEADERS = new Set(['gpgsig', 'gpgsig-sha256']);

/**
 * Parsea el objeto commit.
 *
 * El detalle que importa: `signedPayload` es el objeto **sin la cabecera de firma**, que es
 * exactamente lo que git firma. Reconstruirlo mal produce una firma que no verifica aunque sea
 * legítima, así que aquí se hace por líneas, sin regex sobre el conjunto.
 */
export function parseCommit(bytes: Uint8Array): GitCommit {
  const text = DECODER.decode(bytes);
  const separator = text.indexOf('\n\n');
  if (separator === -1)
    throw new GitFormatError('no hay línea en blanco entre cabeceras y mensaje');

  const headerText = text.slice(0, separator);
  const message = text.slice(separator + 2);

  const tree: string[] = [];
  const parents: string[] = [];
  const author: string[] = [];
  const committer: string[] = [];
  let signature: string | undefined;
  let signatureHeader: string | undefined;
  const keptHeaderLines: string[] = [];

  const lines = headerText.split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    index++;
    const space = line.indexOf(' ');
    if (space <= 0) throw new GitFormatError(`cabecera mal formada: ${JSON.stringify(line)}`);
    const name = line.slice(0, space);
    let value = line.slice(space + 1);

    // Continuaciones: git las escribe con un espacio inicial que no forma parte del valor.
    const continuation: string[] = [];
    while (index < lines.length && (lines[index] ?? '').startsWith(' ')) {
      continuation.push((lines[index] ?? '').slice(1));
      index++;
    }
    if (continuation.length > 0) value = [value, ...continuation].join('\n');

    if (SIGNATURE_HEADERS.has(name)) {
      if (signature !== undefined) throw new GitFormatError('el commit trae dos firmas');
      signature = value;
      signatureHeader = name;
      continue; // fuera del payload firmado
    }

    keptHeaderLines.push(line, ...continuation.map((c) => ` ${c}`));
    if (name === 'tree') tree.push(value);
    else if (name === 'parent') parents.push(value);
    else if (name === 'author') author.push(value);
    else if (name === 'committer') committer.push(value);
  }

  if (tree.length !== 1) throw new GitFormatError('un commit tiene exactamente un `tree`');
  if (author.length !== 1) throw new GitFormatError('un commit tiene exactamente un `author`');
  if (committer.length !== 1)
    throw new GitFormatError('un commit tiene exactamente un `committer`');

  const signedPayload = UTF8.encode(`${keptHeaderLines.join('\n')}\n\n${message}`);

  return {
    bytes,
    tree: tree[0] ?? '',
    parents,
    author: author[0] ?? '',
    committer: committer[0] ?? '',
    signature,
    signatureHeader,
    signedPayload,
    message,
  };
}

/** Construye los bytes de un objeto commit. Se usa en los tests para firmar de verdad. */
export function buildCommitBytes(input: {
  readonly tree: string;
  readonly parents?: readonly string[];
  readonly author: string;
  readonly committer: string;
  readonly signature?: string;
  readonly message: string;
}): Uint8Array {
  const lines: string[] = [`tree ${input.tree}`];
  for (const parent of input.parents ?? []) lines.push(`parent ${parent}`);
  lines.push(`author ${input.author}`, `committer ${input.committer}`);
  if (input.signature !== undefined) {
    const [first, ...rest] = input.signature.split('\n');
    lines.push(`gpgsig ${first ?? ''}`, ...rest.map((line) => ` ${line}`));
  }
  return UTF8.encode(`${lines.join('\n')}\n\n${input.message}`);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// SSHSIG
// ═════════════════════════════════════════════════════════════════════════════════════════════

const SSHSIG_MAGIC = UTF8.encode('SSHSIG');
const SSHSIG_VERSION = 1;
const ARMOR_BEGIN = '-----BEGIN SSH SIGNATURE-----';
const ARMOR_END = '-----END SSH SIGNATURE-----';

export interface SshSignature {
  readonly version: number;
  /** Blob de clave pública SSH (`string tipo ‖ string clave`), tal cual. */
  readonly publicKeyBlob: Uint8Array;
  readonly keyType: string;
  /** Material de la clave. Para `ssh-ed25519`, 32 bytes. */
  readonly publicKey: Uint8Array;
  readonly namespace: string;
  readonly reserved: Uint8Array;
  readonly hashAlgorithm: string;
  readonly signatureType: string;
  readonly signature: Uint8Array;
}

function readString(bytes: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  if (offset + 4 > bytes.length) throw new SshSigError('longitud de cadena truncada');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(offset, false);
  if (offset + 4 + length > bytes.length) throw new SshSigError('cadena truncada');
  return { value: bytes.slice(offset + 4, offset + 4 + length), next: offset + 4 + length };
}

function writeString(parts: Uint8Array[], value: Uint8Array): void {
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, value.length, false);
  parts.push(header, value);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Quita la armadura `-----BEGIN SSH SIGNATURE-----` y devuelve los bytes del blob. */
export function dearmorSshSignature(armored: string): Uint8Array {
  const begin = armored.indexOf(ARMOR_BEGIN);
  const end = armored.indexOf(ARMOR_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new SshSigError('faltan las líneas BEGIN/END SSH SIGNATURE');
  }
  return fromBase64(armored.slice(begin + ARMOR_BEGIN.length, end));
}

export function armorSshSignature(blob: Uint8Array): string {
  // OpenSSH parte la armadura cada 70 caracteres.
  const text = toBase64(blob);
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += 70) lines.push(text.slice(i, i + 70));
  return `${ARMOR_BEGIN}\n${lines.join('\n')}\n${ARMOR_END}`;
}

export function parseSshSignature(armored: string): SshSignature {
  const blob = dearmorSshSignature(armored);
  for (let i = 0; i < SSHSIG_MAGIC.length; i++) {
    if (blob[i] !== SSHSIG_MAGIC[i]) throw new SshSigError('el preámbulo no es SSHSIG');
  }
  let offset = SSHSIG_MAGIC.length;
  if (offset + 4 > blob.length) throw new SshSigError('versión truncada');
  const version = new DataView(blob.buffer, blob.byteOffset, blob.byteLength).getUint32(
    offset,
    false,
  );
  offset += 4;
  if (version !== SSHSIG_VERSION) throw new SshSigError(`versión ${String(version)} desconocida`);

  const publicKeyField = readString(blob, offset);
  offset = publicKeyField.next;
  const namespaceField = readString(blob, offset);
  offset = namespaceField.next;
  const reservedField = readString(blob, offset);
  offset = reservedField.next;
  const hashField = readString(blob, offset);
  offset = hashField.next;
  const signatureField = readString(blob, offset);
  offset = signatureField.next;
  if (offset !== blob.length) throw new SshSigError('sobran bytes al final de la firma');

  const keyTypeField = readString(publicKeyField.value, 0);
  const keyMaterial = readString(publicKeyField.value, keyTypeField.next);
  const sigTypeField = readString(signatureField.value, 0);
  const sigMaterial = readString(signatureField.value, sigTypeField.next);

  return {
    version,
    publicKeyBlob: publicKeyField.value,
    keyType: DECODER.decode(keyTypeField.value),
    publicKey: keyMaterial.value,
    namespace: DECODER.decode(namespaceField.value),
    reserved: reservedField.value,
    hashAlgorithm: DECODER.decode(hashField.value),
    signatureType: DECODER.decode(sigTypeField.value),
    signature: sigMaterial.value,
  };
}

/**
 * Los bytes que OpenSSH firma de verdad:
 *
 *     "SSHSIG" ‖ string(namespace) ‖ string(reserved) ‖ string(hashAlgorithm) ‖ string(H(mensaje))
 *
 * El mensaje **no** se firma directamente: se firma su resumen dentro de este sobre, y el sobre
 * incluye el `namespace`. Por eso una firma hecha para `git` no vale para `file` ni al revés, que
 * es justo lo que impide reutilizar una firma de otro contexto.
 */
export async function sshSignedBlob(
  namespace: string,
  reserved: Uint8Array,
  hashAlgorithm: string,
  message: Uint8Array,
): Promise<Uint8Array> {
  const algorithm =
    hashAlgorithm === 'sha512' ? 'SHA-512' : hashAlgorithm === 'sha256' ? 'SHA-256' : undefined;
  if (algorithm === undefined) {
    throw new SshSigError(`algoritmo de resumen '${hashAlgorithm}' no admitido`);
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, message));
  const parts: Uint8Array[] = [SSHSIG_MAGIC];
  writeString(parts, UTF8.encode(namespace));
  writeString(parts, reserved);
  writeString(parts, UTF8.encode(hashAlgorithm));
  writeString(parts, digest);
  return concat(parts);
}

/** Construye el blob `SSHSIG` completo. Se usa en los tests para firmar de verdad. */
export function buildSshSignatureBlob(input: {
  readonly publicKeyBlob: Uint8Array;
  readonly namespace: string;
  readonly hashAlgorithm: string;
  readonly signatureType: string;
  readonly signature: Uint8Array;
}): Uint8Array {
  const parts: Uint8Array[] = [SSHSIG_MAGIC];
  const version = new Uint8Array(4);
  new DataView(version.buffer).setUint32(0, SSHSIG_VERSION, false);
  parts.push(version);
  writeString(parts, input.publicKeyBlob);
  writeString(parts, UTF8.encode(input.namespace));
  writeString(parts, new Uint8Array(0));
  writeString(parts, UTF8.encode(input.hashAlgorithm));
  const signatureField: Uint8Array[] = [];
  writeString(signatureField, UTF8.encode(input.signatureType));
  writeString(signatureField, input.signature);
  writeString(parts, concat(signatureField));
  return concat(parts);
}

/** Blob de clave pública SSH: `string(tipo) ‖ string(material)`. */
export function sshPublicKeyBlob(keyType: string, material: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  writeString(parts, UTF8.encode(keyType));
  writeString(parts, material);
  return concat(parts);
}

/**
 * Verifica la firma Ed25519 contra el mensaje. Nada de red, nada de dependencias: WebCrypto trae
 * Ed25519 desde Node 22, y es el mismo código que corre en el navegador de quien audita.
 */
export async function verifySshEd25519(
  signature: SshSignature,
  message: Uint8Array,
): Promise<boolean> {
  if (signature.keyType !== 'ssh-ed25519' || signature.signatureType !== 'ssh-ed25519') {
    throw new SshSigError(
      `sólo se admite ssh-ed25519; la firma dice '${signature.keyType}'/'${signature.signatureType}'`,
    );
  }
  if (signature.publicKey.length !== 32) throw new SshSigError('la clave Ed25519 no mide 32 bytes');
  if (signature.signature.length !== 64) throw new SshSigError('la firma Ed25519 no mide 64 bytes');

  const blob = await sshSignedBlob(
    signature.namespace,
    signature.reserved,
    signature.hashAlgorithm,
    message,
  );
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    signature.publicKey,
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return globalThis.crypto.subtle.verify({ name: 'Ed25519' }, key, signature.signature, blob);
}
