/**
 * Puertos de la capa HTTP. Todo lo que el servicio necesita del mundo, declarado como interfaz.
 *
 * ═══ Por qué la identidad es un puerto y no una llamada a la Universidad ═══
 *
 * PRODUCT §9 lo dice sin rodeos: el MVP verifica el correo `@udea.edu.co` y **no se integra con el
 * directorio institucional**, porque eso exigiría autorización formal y crearía corresponsabilidad
 * sobre datos que no queremos tener. Pero «hoy no nos integramos» y «el sistema no sabe integrarse»
 * son cosas distintas: lo primero es una decisión, lo segundo es una deuda. El puerto existe para
 * que la decisión se pueda revisar sin reescribir la autenticación, y **no se asume ninguna API de
 * la UdeA**: el adaptador del MVP comprueba el dominio del correo y nada más.
 *
 * ═══ Por qué el reloj y el azar también son puertos ═══
 *
 * Por la misma razón por la que el dominio no los tiene: una prueba que dependa del reloj real es
 * una prueba que falla los martes. Aquí sí hay efectos —esta capa es la que los tiene—, pero entran
 * por un sitio nombrado y sustituible.
 */

import type { CircleId, MemberId, PrivateMaterialContext, Role } from '@koinonia/domain';

/** Corte inicial: detalle textual restringido, acotado por bytes UTF-8. */
export const MAX_RESTRICTED_PRIVATE_TEXT_BYTES = 16 * 1024;

/** Reloj. `now()` en milisegundos desde el epoch UTC. */
export interface ClockPort {
  now: () => number;
}

/** Fuente de aleatoriedad criptográfica. */
export interface RandomPort {
  /** `n` bytes aleatorios. */
  bytes: (n: number) => Uint8Array;
  /** Identificador opaco de 32 hex (128 bits). */
  opaqueId: () => string;
  /** UUID v4, para las claves de idempotencia. */
  uuid: () => string;
}

/** Un correo a punto de salir. Sin plantillas HTML: texto plano, que se lee en cualquier cliente. */
export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface MailerPort {
  send: (mail: OutgoingMail) => Promise<void>;
}

/** Lo que el proveedor de identidad afirma de un correo. */
export interface IdentityClaim {
  readonly email: string;
  /** Nombre para saludar. En el MVP sale del propio correo; nunca entra al historial. */
  readonly alias: string;
  readonly roles: readonly Role[];
  readonly circles: readonly CircleId[];
  readonly semestre: string;
  readonly jornada: string;
}

export type IdentityRejection = {
  readonly ok: false;
  readonly code: 'CORREO_NO_INSTITUCIONAL';
  readonly detail: string;
};

export type IdentityResult =
  { readonly ok: true; readonly claim: IdentityClaim } | IdentityRejection;

/**
 * Puerto de identidad.
 *
 * **No asume ninguna API de la Universidad.** El contrato es: dado un correo, decir si esa persona
 * puede entrar y con qué atributos. Un adaptador futuro que hable con el directorio institucional
 * implementa esta misma interfaz sin tocar una línea de la autenticación.
 */
export interface IdentityProviderAdapter {
  readonly nombre: string;
  verify: (email: string) => Promise<IdentityResult>;
}

/** Sobre de una clave de datos por sujeto. La DSK en claro nunca cruza este puerto. */
export interface SubjectDataKeyEnvelope {
  readonly keyRef: string;
  readonly wrapNonce: Uint8Array;
  readonly wrappedDek: Uint8Array;
  readonly cryptoVersion: number;
}

/** Valor de capacidad autenticado. El tag GCM viaja concatenado al ciphertext. */
export interface CapacityCiphertext {
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

export type PrivateMaterialPurpose = PrivateMaterialContext['purpose'];

/** Apertura que vive canónicamente dentro del ciphertext, nunca en columnas separadas. */
export interface RestrictedTextMaterialOpening {
  /** Nonce del commitment como 32 hex minúsculas (128 bits). */
  readonly nonce128: string;
  readonly context: PrivateMaterialContext;
  readonly content: string;
}

/** Ciphertext de una apertura privada; el tag GCM va concatenado. */
export interface PrivateMaterialCiphertext {
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/**
 * Bóveda de alto nivel para capacidad privada.
 *
 * La capa de persistencia sólo ve sobres y ciphertexts. No recibe una operación AES genérica ni
 * una DSK desenrollada, así que no puede omitir por accidente el AAD de sujeto/campo/revisión.
 */
export interface VaultCryptoPort {
  /** Permite fallar antes de inventar una clave o un formato alternativo. */
  readonly available: boolean;
  createSubjectDataKey: (subjectId: MemberId) => Promise<SubjectDataKeyEnvelope>;
  encryptCapacity: (input: {
    readonly subjectId: MemberId;
    readonly revision: number;
    readonly minutosPorSemana: number;
    readonly subjectKey: SubjectDataKeyEnvelope;
  }) => Promise<CapacityCiphertext>;
  decryptCapacity: (input: {
    readonly subjectId: MemberId;
    readonly revision: number;
    readonly nonce: Uint8Array;
    readonly ciphertext: Uint8Array;
    readonly subjectKey: SubjectDataKeyEnvelope;
  }) => Promise<number>;
  encryptRestrictedTextMaterial: (input: {
    readonly subjectId: MemberId;
    readonly materialId: string;
    readonly purpose: PrivateMaterialPurpose;
    readonly opening: RestrictedTextMaterialOpening;
    readonly subjectKey: SubjectDataKeyEnvelope;
  }) => Promise<PrivateMaterialCiphertext>;
  decryptRestrictedTextMaterial: (input: {
    readonly subjectId: MemberId;
    readonly materialId: string;
    readonly purpose: PrivateMaterialPurpose;
    readonly nonce: Uint8Array;
    readonly ciphertext: Uint8Array;
    readonly subjectKey: SubjectDataKeyEnvelope;
  }) => Promise<RestrictedTextMaterialOpening>;
}

/** Todo lo que la aplicación necesita del exterior, en un solo objeto. */
export interface Ports {
  readonly clock: ClockPort;
  readonly random: RandomPort;
  readonly mailer: MailerPort;
  readonly identity: IdentityProviderAdapter;
  /** Desarrollo sin KEK inyecta explícitamente el adaptador indisponible; nunca se omite. */
  readonly vault: VaultCryptoPort;
}

/** Quien ya demostró ser quien dice. Sin correo: el correo no cruza esta frontera. */
export interface AuthenticatedMember {
  readonly memberId: MemberId;
  readonly alias: string;
  readonly roles: readonly Role[];
  readonly circles: readonly CircleId[];
  readonly expiresAt: number;
}
