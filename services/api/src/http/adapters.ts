/**
 * Adaptadores de los puertos. Lo concreto, aislado y sustituible.
 */

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

import {
  canonicalBytes,
  type CircleId,
  circleId,
  createPrivateMaterialCommitment,
  type Role,
} from '@koinonia/domain';

import { CIRCULOS } from './circles.js';
import { MAX_RESTRICTED_PRIVATE_TEXT_BYTES } from './ports.js';
import type {
  ClockPort,
  IdentityProviderAdapter,
  IdentityResult,
  MailerPort,
  OutgoingMail,
  PrivateMaterialPurpose,
  RandomPort,
  RestrictedTextMaterialOpening,
  SubjectDataKeyEnvelope,
  VaultCryptoPort,
} from './ports.js';

export const systemClock: ClockPort = { now: () => Date.now() };

export const cryptoRandom: RandomPort = {
  bytes: (n: number) => new Uint8Array(randomBytes(n)),
  opaqueId: () => randomBytes(16).toString('hex'),
  uuid: () => randomUUID(),
};

const VAULT_CRYPTO_VERSION = 1;
const AES_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
/**
 * Formato de la apertura textual, independiente de la versión de la DSK.
 *
 * El ciphertext tiene longitud fija para que una lectura de la base no convierta
 * `octet_length(ciphertext)` en un oráculo del tamaño exacto del texto. 128 KiB cubren holgadamente
 * el peor caso de JSON canónico para 16 KiB de entrada UTF-8 (cada control puede ocupar seis bytes)
 * más el contexto cerrado de ADR-0045.
 */
const PRIVATE_MATERIAL_FORMAT_VERSION = 2;
const PRIVATE_MATERIAL_FRAME_BYTES = 128 * 1024;
const PRIVATE_MATERIAL_FRAME_MAGIC = Buffer.from('KOINPM02', 'ascii');
const PRIVATE_MATERIAL_FRAME_HEADER_BYTES = PRIVATE_MATERIAL_FRAME_MAGIC.length + 4;
const CAPACITY_FIELD = 'identity.contribution_capacity.minutos_por_semana';
const PRIVATE_MATERIAL_PURPOSES: ReadonlySet<string> = new Set([
  'task-block-detail',
  'task-help-detail',
  'task-evidence-object',
  'task-delivery-summary',
  'task-change-detail',
]);

/** Error deliberadamente opaco: ni las causas del proveedor ni material criptográfico suben. */
export class VaultCryptoError extends Error {
  constructor() {
    super('la bóveda no pudo autenticar el dato privado');
    this.name = 'VaultCryptoError';
  }
}

/** Adaptador explícito para desarrollo sin KEK. No cifra con una clave conocida ni guarda texto. */
export class VaultUnavailableError extends Error {
  constructor() {
    super('la bóveda privada no está configurada');
    this.name = 'VaultUnavailableError';
  }
}

function aesGcmEncrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: GCM_TAG_BYTES });
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Uint8Array.from(Buffer.concat([encrypted, cipher.getAuthTag()]));
}

function aesGcmDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  sealed: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  if (sealed.length < GCM_TAG_BYTES) throw new VaultCryptoError();
  const encrypted = sealed.subarray(0, sealed.length - GCM_TAG_BYTES);
  const tag = sealed.subarray(sealed.length - GCM_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
    authTagLength: GCM_TAG_BYTES,
  });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Uint8Array.from(Buffer.concat([decipher.update(encrypted), decipher.final()]));
}

function wrapAad(subjectId: string, keyRef: string, version: number): Uint8Array {
  return Buffer.from(
    `koinonia:vault:key-wrap:v${String(version)}\0${subjectId}\0${keyRef}`,
    'utf8',
  );
}

function capacityAad(subjectId: string, revision: number, version: number): Uint8Array {
  return Buffer.from(
    `koinonia:vault:capacity:v${String(version)}\0${subjectId}\0${CAPACITY_FIELD}\0${String(revision)}`,
    'utf8',
  );
}

function privateMaterialAad(
  subjectId: string,
  materialId: string,
  purpose: PrivateMaterialPurpose,
  version: number,
  formatVersion?: number,
): Uint8Array {
  return Buffer.from(
    `koinonia:vault:private-material:v${String(version)}` +
      `${formatVersion === undefined ? '' : `:f${String(formatVersion)}`}\0` +
      `${subjectId}\0${materialId}\0${purpose}`,
    'utf8',
  );
}

function validPrivateCoordinates(subjectId: string, materialId: string, purpose: string): boolean {
  return (
    /^[0-9a-f]{32}$/u.test(subjectId) &&
    /^[0-9a-f]{32}$/u.test(materialId) &&
    PRIVATE_MATERIAL_PURPOSES.has(purpose)
  );
}

function parseOpeningShape(bytes: Uint8Array): RestrictedTextMaterialOpening {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const candidate: unknown = JSON.parse(decoded);
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new VaultCryptoError();
  }
  const keys = Object.keys(candidate).sort();
  if (keys.join('\0') !== ['content', 'context', 'nonce128'].join('\0')) {
    throw new VaultCryptoError();
  }
  const record = candidate as Record<string, unknown>;
  const nonce128 = record['nonce128'];
  const context = record['context'];
  const content = record['content'];
  if (
    typeof nonce128 !== 'string' ||
    !/^[0-9a-f]{32}$/u.test(nonce128) ||
    typeof context !== 'object' ||
    context === null ||
    Array.isArray(context) ||
    typeof content !== 'string'
  ) {
    throw new VaultCryptoError();
  }
  return { nonce128, context: context as RestrictedTextMaterialOpening['context'], content };
}

async function validateOpening(
  opening: RestrictedTextMaterialOpening,
  purpose: PrivateMaterialPurpose,
): Promise<void> {
  const contentBytes = Buffer.byteLength(opening.content, 'utf8');
  if (contentBytes < 1 || contentBytes > MAX_RESTRICTED_PRIVATE_TEXT_BYTES) {
    throw new VaultCryptoError();
  }
  if (opening.context.purpose !== purpose || opening.context.visibility !== 'restricted') {
    throw new VaultCryptoError();
  }
  await createPrivateMaterialCommitment({
    nonce: Buffer.from(opening.nonce128, 'hex'),
    context: opening.context,
    content: opening.content,
  });
}

async function canonicalOpeningBytes(
  opening: RestrictedTextMaterialOpening,
  purpose: PrivateMaterialPurpose,
): Promise<Uint8Array> {
  // Canonicalizar primero crea un snapshot: una mutación durante el `await` no separa commitment y
  // ciphertext. Reparsear además impide que getters/prototipos sobrevivan a la frontera.
  const bytes = canonicalBytes(opening);
  const snapshot = parseOpeningShape(bytes);
  await validateOpening(snapshot, purpose);
  if (!Buffer.from(bytes).equals(Buffer.from(canonicalBytes(snapshot)))) {
    throw new VaultCryptoError();
  }
  return bytes;
}

async function parseCanonicalOpening(
  bytes: Uint8Array,
  purpose: PrivateMaterialPurpose,
): Promise<RestrictedTextMaterialOpening> {
  const opening = parseOpeningShape(bytes);
  await validateOpening(opening, purpose);
  if (!Buffer.from(bytes).equals(Buffer.from(canonicalBytes(opening)))) {
    throw new VaultCryptoError();
  }
  return opening;
}

function paddedPrivateMaterialFrame(canonicalOpening: Uint8Array): Uint8Array {
  if (
    canonicalOpening.length < 1 ||
    canonicalOpening.length > PRIVATE_MATERIAL_FRAME_BYTES - PRIVATE_MATERIAL_FRAME_HEADER_BYTES
  ) {
    throw new VaultCryptoError();
  }
  const frame = Buffer.alloc(PRIVATE_MATERIAL_FRAME_BYTES);
  PRIVATE_MATERIAL_FRAME_MAGIC.copy(frame, 0);
  frame.writeUInt32BE(canonicalOpening.length, PRIVATE_MATERIAL_FRAME_MAGIC.length);
  frame.set(canonicalOpening, PRIVATE_MATERIAL_FRAME_HEADER_BYTES);
  return Uint8Array.from(frame);
}

function openingBytesFromPaddedFrame(frame: Uint8Array): Uint8Array {
  if (frame.length !== PRIVATE_MATERIAL_FRAME_BYTES) throw new VaultCryptoError();
  const bytes = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
  if (
    !bytes.subarray(0, PRIVATE_MATERIAL_FRAME_MAGIC.length).equals(PRIVATE_MATERIAL_FRAME_MAGIC)
  ) {
    throw new VaultCryptoError();
  }
  const length = bytes.readUInt32BE(PRIVATE_MATERIAL_FRAME_MAGIC.length);
  if (length < 1 || length > PRIVATE_MATERIAL_FRAME_BYTES - PRIVATE_MATERIAL_FRAME_HEADER_BYTES) {
    throw new VaultCryptoError();
  }
  // El relleno también queda autenticado por GCM. Exigir su forma canónica evita aceptar dos
  // frames distintos para una misma apertura si algún adaptador futuro construye uno a mano.
  for (const byte of bytes.subarray(PRIVATE_MATERIAL_FRAME_HEADER_BYTES + length)) {
    if (byte !== 0) throw new VaultCryptoError();
  }
  return bytes.subarray(
    PRIVATE_MATERIAL_FRAME_HEADER_BYTES,
    PRIVATE_MATERIAL_FRAME_HEADER_BYTES + length,
  );
}

function validEnvelope(subjectKey: SubjectDataKeyEnvelope): boolean {
  return (
    subjectKey.cryptoVersion === VAULT_CRYPTO_VERSION &&
    /^[0-9a-f]{32}$/u.test(subjectKey.keyRef) &&
    subjectKey.wrapNonce.length === GCM_NONCE_BYTES &&
    subjectKey.wrappedDek.length >= AES_KEY_BYTES + GCM_TAG_BYTES
  );
}

/**
 * AES-256-GCM real con envelope encryption: una KEK inyectada envuelve una DSK aleatoria por
 * sujeto. Cada escritura usa nonce nuevo y el AAD fija sujeto, campo y revisión.
 */
export class NodeAes256GcmVaultCrypto implements VaultCryptoPort {
  readonly available = true;
  readonly #masterKey: Buffer;

  constructor(masterKey: Uint8Array) {
    if (masterKey.length !== AES_KEY_BYTES) {
      throw new TypeError('la KEK de la bóveda debe medir exactamente 32 bytes');
    }
    this.#masterKey = Buffer.from(masterKey);
  }

  async createSubjectDataKey(
    subjectId: Parameters<VaultCryptoPort['createSubjectDataKey']>[0],
  ): Promise<SubjectDataKeyEnvelope> {
    await Promise.resolve();
    const keyRef = randomBytes(16).toString('hex');
    const wrapNonce = randomBytes(GCM_NONCE_BYTES);
    const dek = randomBytes(AES_KEY_BYTES);
    try {
      const wrappedDek = aesGcmEncrypt(
        this.#masterKey,
        wrapNonce,
        dek,
        wrapAad(subjectId, keyRef, VAULT_CRYPTO_VERSION),
      );
      return {
        keyRef,
        wrapNonce: Uint8Array.from(wrapNonce),
        wrappedDek,
        cryptoVersion: VAULT_CRYPTO_VERSION,
      };
    } finally {
      dek.fill(0);
    }
  }

  async encryptCapacity(
    input: Parameters<VaultCryptoPort['encryptCapacity']>[0],
  ): Promise<Awaited<ReturnType<VaultCryptoPort['encryptCapacity']>>> {
    await Promise.resolve();
    if (
      !validEnvelope(input.subjectKey) ||
      !Number.isSafeInteger(input.revision) ||
      input.revision <= 0 ||
      !Number.isSafeInteger(input.minutosPorSemana) ||
      input.minutosPorSemana < 0 ||
      input.minutosPorSemana > 10_080
    ) {
      throw new VaultCryptoError();
    }

    let dek: Uint8Array | undefined;
    let plaintext: Buffer | undefined;
    try {
      dek = aesGcmDecrypt(
        this.#masterKey,
        input.subjectKey.wrapNonce,
        input.subjectKey.wrappedDek,
        wrapAad(input.subjectId, input.subjectKey.keyRef, input.subjectKey.cryptoVersion),
      );
      if (dek.length !== AES_KEY_BYTES) throw new VaultCryptoError();
      plaintext = Buffer.alloc(4);
      plaintext.writeUInt32BE(input.minutosPorSemana);
      const nonce = randomBytes(GCM_NONCE_BYTES);
      return {
        nonce: Uint8Array.from(nonce),
        ciphertext: aesGcmEncrypt(
          dek,
          nonce,
          plaintext,
          capacityAad(input.subjectId, input.revision, input.subjectKey.cryptoVersion),
        ),
      };
    } catch {
      throw new VaultCryptoError();
    } finally {
      dek?.fill(0);
      plaintext?.fill(0);
    }
  }

  async decryptCapacity(input: Parameters<VaultCryptoPort['decryptCapacity']>[0]): Promise<number> {
    await Promise.resolve();
    if (
      !validEnvelope(input.subjectKey) ||
      !Number.isSafeInteger(input.revision) ||
      input.revision <= 0 ||
      input.nonce.length !== GCM_NONCE_BYTES ||
      input.ciphertext.length < GCM_TAG_BYTES
    ) {
      throw new VaultCryptoError();
    }

    let dek: Uint8Array | undefined;
    let plaintext: Uint8Array | undefined;
    try {
      dek = aesGcmDecrypt(
        this.#masterKey,
        input.subjectKey.wrapNonce,
        input.subjectKey.wrappedDek,
        wrapAad(input.subjectId, input.subjectKey.keyRef, input.subjectKey.cryptoVersion),
      );
      if (dek.length !== AES_KEY_BYTES) throw new VaultCryptoError();
      plaintext = aesGcmDecrypt(
        dek,
        input.nonce,
        input.ciphertext,
        capacityAad(input.subjectId, input.revision, input.subjectKey.cryptoVersion),
      );
      if (plaintext.length !== 4) throw new VaultCryptoError();
      const minutos = Buffer.from(plaintext).readUInt32BE(0);
      if (minutos > 10_080) throw new VaultCryptoError();
      return minutos;
    } catch {
      throw new VaultCryptoError();
    } finally {
      dek?.fill(0);
      plaintext?.fill(0);
    }
  }

  async encryptRestrictedTextMaterial(
    input: Parameters<VaultCryptoPort['encryptRestrictedTextMaterial']>[0],
  ): Promise<Awaited<ReturnType<VaultCryptoPort['encryptRestrictedTextMaterial']>>> {
    if (
      !validEnvelope(input.subjectKey) ||
      !validPrivateCoordinates(input.subjectId, input.materialId, input.purpose)
    ) {
      throw new VaultCryptoError();
    }

    let dek: Uint8Array | undefined;
    let canonical: Uint8Array | undefined;
    let plaintext: Uint8Array | undefined;
    try {
      canonical = await canonicalOpeningBytes(input.opening, input.purpose);
      plaintext = paddedPrivateMaterialFrame(canonical);
      dek = aesGcmDecrypt(
        this.#masterKey,
        input.subjectKey.wrapNonce,
        input.subjectKey.wrappedDek,
        wrapAad(input.subjectId, input.subjectKey.keyRef, input.subjectKey.cryptoVersion),
      );
      if (dek.length !== AES_KEY_BYTES) throw new VaultCryptoError();
      const nonce = randomBytes(GCM_NONCE_BYTES);
      return {
        nonce: Uint8Array.from(nonce),
        ciphertext: aesGcmEncrypt(
          dek,
          nonce,
          plaintext,
          privateMaterialAad(
            input.subjectId,
            input.materialId,
            input.purpose,
            input.subjectKey.cryptoVersion,
            PRIVATE_MATERIAL_FORMAT_VERSION,
          ),
        ),
      };
    } catch {
      throw new VaultCryptoError();
    } finally {
      dek?.fill(0);
      canonical?.fill(0);
      plaintext?.fill(0);
    }
  }

  async decryptRestrictedTextMaterial(
    input: Parameters<VaultCryptoPort['decryptRestrictedTextMaterial']>[0],
  ): Promise<RestrictedTextMaterialOpening> {
    if (
      !validEnvelope(input.subjectKey) ||
      !validPrivateCoordinates(input.subjectId, input.materialId, input.purpose) ||
      input.nonce.length !== GCM_NONCE_BYTES ||
      input.ciphertext.length < GCM_TAG_BYTES
    ) {
      throw new VaultCryptoError();
    }

    let dek: Uint8Array | undefined;
    let plaintext: Uint8Array | undefined;
    try {
      dek = aesGcmDecrypt(
        this.#masterKey,
        input.subjectKey.wrapNonce,
        input.subjectKey.wrappedDek,
        wrapAad(input.subjectId, input.subjectKey.keyRef, input.subjectKey.cryptoVersion),
      );
      if (dek.length !== AES_KEY_BYTES) throw new VaultCryptoError();
      const padded = input.ciphertext.length === PRIVATE_MATERIAL_FRAME_BYTES + GCM_TAG_BYTES;
      plaintext = aesGcmDecrypt(
        dek,
        input.nonce,
        input.ciphertext,
        privateMaterialAad(
          input.subjectId,
          input.materialId,
          input.purpose,
          input.subjectKey.cryptoVersion,
          padded ? PRIVATE_MATERIAL_FORMAT_VERSION : undefined,
        ),
      );
      // Compatibilidad de lectura: las filas del corte inicial no tenían frame ni sufijo de
      // formato en el AAD. Todas las escrituras nuevas usan f2 y longitud fija.
      const canonical = padded ? openingBytesFromPaddedFrame(plaintext) : plaintext;
      return await parseCanonicalOpening(canonical, input.purpose);
    } catch {
      throw new VaultCryptoError();
    } finally {
      dek?.fill(0);
      plaintext?.fill(0);
    }
  }
}

/** Bóveda cerrada que se inyecta cuando desarrollo no tiene una KEK. */
export const unavailableVaultCrypto: VaultCryptoPort = {
  available: false,
  createSubjectDataKey: () => Promise.reject(new VaultUnavailableError()),
  encryptCapacity: () => Promise.reject(new VaultUnavailableError()),
  decryptCapacity: () => Promise.reject(new VaultUnavailableError()),
  encryptRestrictedTextMaterial: () => Promise.reject(new VaultUnavailableError()),
  decryptRestrictedTextMaterial: () => Promise.reject(new VaultUnavailableError()),
};

/**
 * Correo por consola, para desarrollo.
 *
 * Escribe en la salida estándar en lugar de mandar nada. Es el adaptador que hace posible levantar
 * el proyecto sin un servidor de correo, y **también** el que hace posible que las pruebas lean el
 * enlace: `MemoryMailer` guarda lo mismo en memoria.
 */
export const consoleMailer: MailerPort = {
  send: async (mail: OutgoingMail): Promise<void> => {
    process.stdout.write(
      `\n──────── correo (adaptador de consola) ────────\n` +
        `Para: ${mail.to}\nAsunto: ${mail.subject}\n\n${mail.text}\n` +
        `──────────────────────────────────────────────\n\n`,
    );
    await Promise.resolve();
  },
};

/** Correo en memoria: lo mismo, pero recuperable. Para las pruebas y para el modo de desarrollo. */
export class MemoryMailer implements MailerPort {
  readonly enviados: OutgoingMail[] = [];

  async send(mail: OutgoingMail): Promise<void> {
    this.enviados.push(mail);
    await Promise.resolve();
  }

  ultimoPara(to: string): OutgoingMail | undefined {
    return this.enviados.filter((mail) => mail.to === to).at(-1);
  }
}

/** Dominio institucional. Es lo único que el MVP verifica (PRODUCT §9). */
export const DOMINIO_INSTITUCIONAL = 'udea.edu.co';

/**
 * Adaptador de identidad del MVP.
 *
 * Comprueba que el correo termina en `@udea.edu.co` y **nada más**. No consulta el directorio de la
 * Universidad, no valida la matrícula contra ningún sistema y no inventa una API que no conocemos.
 *
 * DECISIÓN: esto significa que cualquier persona con un correo institucional entra, incluido el
 * personal docente y administrativo, que no son parte del padrón estudiantil. Es una **debilidad
 * conocida y declarada**, no un descuido: la alternativa —pedir a la Universidad un listado de
 * matriculados— exige un convenio, crea corresponsabilidad sobre datos personales de 300 personas y
 * pone la existencia de la plataforma en manos de la institución que la plataforma va a interpelar.
 * Se prefiere una puerta ancha y declarada a una dependencia institucional silenciosa. La
 * controversia sobre quién es miembro va al Círculo de Garantías (GOVERNANCE §4, fila 19).
 *
 * El alias sale de la parte local del correo. Nunca entra al historial: el historial no guarda
 * personas.
 */
export function udeaIdentityAdapter(options?: {
  /** Correos que además reciben el rol de facilitación. Los fija la operación, no la aplicación. */
  readonly facilitadores?: readonly string[];
  readonly garantias?: readonly string[];
  readonly circulos?: readonly CircleId[];
}): IdentityProviderAdapter {
  const facilitadores = new Set((options?.facilitadores ?? []).map((e) => e.trim().toLowerCase()));
  const garantias = new Set((options?.garantias ?? []).map((e) => e.trim().toLowerCase()));
  const circulos = options?.circulos ?? [
    circleId(CIRCULOS.asamblea.id),
    circleId(CIRCULOS.espacios.id),
  ];

  return {
    nombre: 'udea-dominio-de-correo',
    verify: async (email: string): Promise<IdentityResult> => {
      const normalizado = email.trim().toLowerCase();
      if (!normalizado.endsWith(`@${DOMINIO_INSTITUCIONAL}`)) {
        return {
          ok: false,
          code: 'CORREO_NO_INSTITUCIONAL',
          detail: `sólo entran los correos que terminan en @${DOMINIO_INSTITUCIONAL}`,
        };
      }
      const local = normalizado.slice(0, normalizado.indexOf('@'));
      if (local.length === 0) {
        return {
          ok: false,
          code: 'CORREO_NO_INSTITUCIONAL',
          detail: 'el correo no tiene parte local',
        };
      }
      const roles: Role[] = ['member'];
      if (facilitadores.has(normalizado)) roles.push('facilitator');
      if (garantias.has(normalizado)) roles.push('guarantees');
      return await Promise.resolve({
        ok: true,
        claim: {
          email: normalizado,
          alias: local,
          roles,
          circles: circulos,
          semestre: 's1',
          jornada: 'diurna',
        },
      });
    },
  };
}
