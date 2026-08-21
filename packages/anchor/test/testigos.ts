/**
 * Utillaje de las pruebas de anclaje: claves Ed25519 de verdad, firmas SSH de verdad, commits de
 * git de verdad.
 *
 * Nada de dobles. Si la firma de estos tests fuera simulada, las pruebas dirían que el verificador
 * acepta lo que el propio test fabrica, que es exactamente el error que hace inútil un verificador.
 * Aquí se firma con WebCrypto y se comprueba con WebCrypto, por caminos distintos.
 */

import {
  armorSshSignature,
  buildCommitBytes,
  buildSshSignatureBlob,
  sshPublicKeyBlob,
  sshSignedBlob,
  toBase64,
} from '@koinonia/anchor';

const subtle = globalThis.crypto.subtle;

/** `CryptoKey` no está en `lib: ES2022`; se deriva del propio WebCrypto en vez de declararla. */
type Clave = Awaited<ReturnType<typeof subtle.importKey>>;

export interface Firmante {
  /** Blob de clave pública SSH en base64: lo que va en el padrón. */
  readonly publicKey: string;
  readonly publicKeyBlob: Uint8Array;
  /** Firma un mensaje en el contexto `namespace` y devuelve la armadura SSHSIG. */
  firmar(namespace: string, message: Uint8Array, hashAlgorithm?: string): Promise<string>;
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
    publicKeyBlob,
    async firmar(namespace, message, hashAlgorithm = 'sha512') {
      const blob = await sshSignedBlob(namespace, new Uint8Array(0), hashAlgorithm, message);
      const signature = new Uint8Array(
        await subtle.sign({ name: 'Ed25519' }, pair.privateKey, blob),
      );
      return armorSshSignature(
        buildSshSignatureBlob({
          publicKeyBlob,
          namespace,
          hashAlgorithm,
          signatureType: 'ssh-ed25519',
          signature,
        }),
      );
    },
  };
}

export const AUTOR = 'Veeduría <veeduria@ejemplo.org> 1787000000 +0000';
export const ARBOL = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Un commit firmado de verdad, tal como lo produciría `git commit -S` con `gpg.format = ssh`. */
export async function commitFirmado(
  firmante: Firmante,
  mensaje: string,
  opciones: { readonly namespace?: string; readonly tree?: string } = {},
): Promise<Uint8Array> {
  const base = {
    tree: opciones.tree ?? ARBOL,
    author: AUTOR,
    committer: AUTOR,
    message: mensaje,
  };
  const sinFirma = buildCommitBytes(base);
  const armadura = await firmante.firmar(opciones.namespace ?? 'git', sinFirma);
  return buildCommitBytes({ ...base, signature: armadura });
}

/** Reloj inyectado: los paquetes no leen la hora, la reciben. */
export function relojFijo(iso: string): () => string {
  return () => iso;
}

export const T_EMISION = '2026-08-21T03:00:00.000Z';
export const T_AHORA = '2026-08-21T04:00:00.000Z';

/**
 * Lectura textual de un valor JSON de una carga.
 *
 * `String(valor)` sobre un `JsonValue` produciría `[object Object]` si algún día ese campo dejara
 * de ser una cadena, y la aserción pasaría a comprobar otra cosa sin avisar. Aquí se hace explícito.
 */
export function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : JSON.stringify(valor);
}
