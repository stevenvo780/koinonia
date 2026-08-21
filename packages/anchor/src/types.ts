/**
 * `AnchorProvider` — la interfaz enchufable del anclaje externo (§8.3).
 *
 * ═══ Por qué este paquete existe ═══
 *
 * Sin él, Koinonía detecta la manipulación **sólo si alguien conservó una raíz anterior**. Un
 * administrador con `root` puede reescribir la historia entera, recalcular todas las cadenas, todos
 * los árboles y todos los checkpoints, republicar raíces perfectamente coherentes, y nadie lo
 * notaría: la nueva historia es internamente indistinguible de la vieja. La criptografía interna no
 * puede cerrar ese hueco, porque el atacante controla todos los datos con los que se calcula.
 *
 * Lo único que lo cierra es un **testigo que él no controla**. Eso es lo que hay aquí.
 *
 * ═══ Las dos decisiones de diseño que sostienen la garantía ═══
 *
 *  1. **`verify` funciona sin red siempre que sea criptográficamente posible.** Un verificador que
 *     tiene que preguntarle a un servicio si el anclaje es válido ha cambiado un tercero de
 *     confianza por otro. Lo que se puede comprobar sobre los bytes del recibo, se comprueba sobre
 *     los bytes del recibo. Lo que no —«el bloque 921 447 de Bitcoin tiene esta raíz de Merkle»—
 *     se declara explícitamente como `ResidualClaim`, con instrucciones de contra qué contrastarlo.
 *     Nunca se devuelve `confirmado` por algo que no se comprobó.
 *
 *  2. **`independenceClass` no es decorativa.** El evaluador de quórum exige dos confirmaciones de
 *     **clases distintas**. Tres proveedores que en el fondo dependen del mismo tercero no cuentan
 *     como tres; ése es exactamente el error que hace inútil el anclaje múltiple, y por eso la
 *     política vive en `quorum.ts` como código y no como documentación.
 *
 * DECISIÓN (discrepancia con la spec §8.3): allí la firma es
 * `submit(cp: CheckpointRef)` / `verify(cp, r)`. Aquí es `submit(checkpointHash)` /
 * `verify(receipt, checkpointHash)`. Motivo: el `checkpointHash` **ya se compromete** con
 * `treeSize`, `rootHash`, `headsRoot`, `prevCheckpoint` e `issuedAt` (§6.4), así que pasar el
 * `CheckpointRef` entero no le da al proveedor ninguna afirmación adicional que anclar — pero sí le
 * da cinco campos entre los que elegir, y un proveedor que anclara `rootHash` en vez de
 * `checkpointHash` produciría un recibo que parece bueno y no prueba lo que hace falta. Con un solo
 * argumento de 32 bytes esa clase de error deja de ser expresable.
 */

import type { JsonObject } from '@koinonia/crypto';

/**
 * Octetos de separación de dominio de este paquete.
 *
 * Extienden la tabla de `@koinonia/crypto` (`0x00`…`0x04`) y arrancan en `0x10` para dejar hueco:
 * si algún día el ledger necesita un quinto dominio, no hay que renumerar nada de aquí. Que sean
 * disjuntos importa por lo mismo de siempre: un acuse de correo firmado no debe poder reinterpretarse
 * como un eslabón de la cadena, ni al revés.
 */
export const ANCHOR_DOMAIN = {
  /** Preimagen del acuse de recibo de un testigo por correo. */
  emailAck: 0x10,
} as const;

/**
 * Clase de independencia: **quién tiene que mentir** para que este anclaje mienta.
 *
 * No es una taxonomía técnica sino de modos de falla. Bitcoin exige rehacer trabajo acumulado; una
 * forja exige la colusión de una empresa que no conoce el proyecto y de todos los que clonaron; los
 * testigos exigen que todos pierdan o entreguen su buzón; un log ajeno exige a su operador. Lo que
 * el quórum compra es que **ninguna acción única** —ni con `root`— tumbe dos de estas a la vez.
 */
export type IndependenceClass = 'blockchain' | 'vcs' | 'human-witness' | 'third-party-log';

export const INDEPENDENCE_CLASSES: readonly IndependenceClass[] = [
  'blockchain',
  'human-witness',
  'third-party-log',
  'vcs',
];

export function isIndependenceClass(value: unknown): value is IndependenceClass {
  return typeof value === 'string' && (INDEPENDENCE_CLASSES as readonly string[]).includes(value);
}

/** El checkpoint tal como lo publica `services/api` (§6.4). */
export interface CheckpointRef {
  readonly treeSize: bigint;
  readonly rootHash: Uint8Array;
  readonly headsRoot: Uint8Array;
  readonly checkpointHash: Uint8Array;
  readonly issuedAt: string;
}

/**
 * Recibo de anclaje. **Es un dato hostil**: viaja en un export público que sirve el mismo servidor
 * que se está auditando, así que todo lo que lo lee tiene que validarlo antes de creerle.
 *
 * Se representa como JSON canónico (JCS, perfil del ledger) para que su hash sea estable y para que
 * pueda escribirse tal cual como carga de un evento del agregado `#anclaje`.
 */
export interface AnchorReceipt {
  /** `id` del proveedor que lo emitió. */
  readonly provider: string;
  /** Clase que el recibo **declara**. Se contrasta con la del proveedor: mentir aquí es detectable. */
  readonly independenceClass: IndependenceClass;
  /** A qué se comprometió, en 64 hex minúsculas. */
  readonly checkpointHash: string;
  /** Referencia externa: `txid`, OID del commit, `Message-ID`, UUID de entrada de log. */
  readonly externalRef: string;
  /** RFC 3339 UTC exacto. */
  readonly submittedAt: string;
  /** Ausente mientras el anclaje está pendiente. Nunca `null` (§1.3.d). */
  readonly confirmedAt?: string;
  /** Bytes opacos del proveedor (el `.ots`), en base64url sin relleno. */
  readonly proof?: string;
  /** Datos estructurados del proveedor, tal como hacen falta para reverificar a mano. */
  readonly raw: JsonObject;
}

/** Una comprobación concreta dentro de `verify`, con su veredicto. Es lo que se pega en un acta. */
export interface CheckOutcome {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Afirmación que **no se pudo cerrar sin red**, y contra qué contrastarla.
 *
 * Existe para que sea imposible devolver `confirmado` por algo que no se comprobó. Si el verificador
 * no puede cerrar una afirmación, la nombra y dice dónde mirar; nunca la da por buena.
 */
export interface ResidualClaim {
  readonly claim: string;
  readonly verifyBy: string;
}

/**
 * - `confirmado` — el recibo prueba el anclaje con los bytes que hay. **Sólo esto cuenta para el
 *   quórum.**
 * - `pendiente`  — el recibo está bien formado y el anclaje aún no maduró (sello OTS sin bloque,
 *   commit aún sin firmar por la veeduría). No es un fallo; todavía no es una prueba.
 * - `incompleto` — todo lo comprobable cuadra, pero queda una afirmación que exige un dato externo
 *   (una cabecera de bloque, la presencia en una forja). Se listan en `residualClaims`.
 * - `invalido`   — el recibo no corresponde a este checkpoint, o fue manipulado. Es una alarma.
 */
export type VerificationStatus = 'confirmado' | 'pendiente' | 'incompleto' | 'invalido';

export interface VerificationOutcome {
  readonly status: VerificationStatus;
  readonly provider: string;
  readonly independenceClass: IndependenceClass;
  /** `true` ⇒ nada de lo comprobado necesitó red. */
  readonly offline: boolean;
  readonly checks: readonly CheckOutcome[];
  readonly residualClaims: readonly ResidualClaim[];
  /** Una línea en castellano llano. Es lo que se enseña a quien no sabe qué es un hash. */
  readonly detail: string;
  /** Instante externo **demostrado** por el anclaje, si lo hay. No es `occurredAt` (§«no garantiza» 8). */
  readonly attestedAt?: string;
}

/**
 * Metadatos de la clase de independencia del proveedor.
 *
 * `signingKeyOffHost` es el campo más importante del paquete y el que impide que el anclaje sea
 * teatro: si la clave privada vive en el mismo VPS que se está auditando, el administrador que
 * reescribe la historia **firma la raíz nueva**, y el anclaje 2 no vale nada (§8.2). La política de
 * quórum descuenta a esos proveedores, así que el riesgo no es una advertencia en un documento sino
 * una condición comprobada por código y por una prueba.
 */
export interface ProviderMetadata {
  readonly id: string;
  readonly independenceClass: IndependenceClass;
  /** Quién tiene que mentir para que este anclaje mienta. Prosa, para el informe. */
  readonly trustAssumption: string;
  /** `true` ⇒ `verify` deja afirmaciones abiertas que sólo cierran con red o con un dato externo. */
  readonly verificationNeedsNetwork: boolean;
  /**
   * `true` ⇒ el material privado de firma **no** vive en la máquina verificada.
   * `false` ⇒ el proveedor es teatro y el quórum lo descuenta.
   */
  readonly signingKeyOffHost: boolean;
  /** Cuánto tarda en madurar, en prosa. Para explicar un `pendiente` sin alarmar. */
  readonly maturationHint: string;
}

export interface AnchorProvider {
  readonly meta: ProviderMetadata;
  /** Envía el compromiso. Puede devolver un recibo **pendiente**: no todo ancla al instante. */
  submit(checkpointHash: Uint8Array): Promise<AnchorReceipt>;
  /** Verifica el recibo contra el checkpoint. Sin red siempre que sea criptográficamente posible. */
  verify(receipt: AnchorReceipt, checkpointHash: Uint8Array): Promise<VerificationOutcome>;
  /** Madura un recibo pendiente. Necesita red por definición; por eso es opcional. */
  poll?(receipt: AnchorReceipt): Promise<AnchorReceipt>;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Validación de forma. Un recibo llega de un fichero público: se valida antes de creerle.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const HEX64 = /^[0-9a-f]{64}$/u;
const RFC3339_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_]*$/u;
const BASE64URL = /^[A-Za-z0-9\-_]*$/u;

const RECEIPT_KEYS = new Set([
  'provider',
  'independenceClass',
  'checkpointHash',
  'externalRef',
  'submittedAt',
  'confirmedAt',
  'proof',
  'raw',
]);

export class InvalidReceiptError extends Error {
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`recibo de anclaje inválido en '${field}': ${detail}`);
    this.name = 'InvalidReceiptError';
    this.field = field;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Valida el sobre del recibo. Rechaza **claves desconocidas**: un campo de más cambia la preimagen
 * y por tanto el hash con el que el recibo quedó registrado en el ledger.
 */
export function assertAnchorReceipt(value: unknown): asserts value is AnchorReceipt {
  if (!isPlainRecord(value))
    throw new InvalidReceiptError('<recibo>', 'no es un objeto JSON plano');

  for (const key of Object.keys(value)) {
    if (!RECEIPT_KEYS.has(key)) throw new InvalidReceiptError(key, 'clave desconocida');
  }

  const provider = value['provider'];
  if (typeof provider !== 'string' || !PROVIDER_ID.test(provider)) {
    throw new InvalidReceiptError('provider', `no cumple ${PROVIDER_ID.source}`);
  }

  if (!isIndependenceClass(value['independenceClass'])) {
    throw new InvalidReceiptError(
      'independenceClass',
      `debe ser una de: ${INDEPENDENCE_CLASSES.join(', ')}`,
    );
  }

  const checkpointHash = value['checkpointHash'];
  if (typeof checkpointHash !== 'string' || !HEX64.test(checkpointHash)) {
    throw new InvalidReceiptError('checkpointHash', 'debe ser 64 hex minúsculas');
  }

  const externalRef = value['externalRef'];
  if (typeof externalRef !== 'string' || externalRef.length === 0 || externalRef.length > 512) {
    throw new InvalidReceiptError('externalRef', 'cadena no vacía de hasta 512 caracteres');
  }

  const submittedAt = value['submittedAt'];
  if (typeof submittedAt !== 'string' || !RFC3339_UTC_MS.test(submittedAt)) {
    throw new InvalidReceiptError('submittedAt', 'debe ser exactamente YYYY-MM-DDTHH:MM:SS.sssZ');
  }

  if ('confirmedAt' in value) {
    const confirmedAt = value['confirmedAt'];
    if (confirmedAt === null) {
      throw new InvalidReceiptError('confirmedAt', 'null prohibido: omití la clave si no confirmó');
    }
    if (typeof confirmedAt !== 'string' || !RFC3339_UTC_MS.test(confirmedAt)) {
      throw new InvalidReceiptError('confirmedAt', 'debe ser exactamente YYYY-MM-DDTHH:MM:SS.sssZ');
    }
  }

  if ('proof' in value) {
    const proof = value['proof'];
    if (typeof proof !== 'string' || !BASE64URL.test(proof) || proof.length === 0) {
      throw new InvalidReceiptError('proof', 'debe ser base64url sin relleno y no vacío');
    }
  }

  if (!isPlainRecord(value['raw'])) {
    throw new InvalidReceiptError('raw', 'debe ser un objeto JSON plano');
  }
}

/** Un fallo de verificación, formateado como `VerificationOutcome` inválido. */
export function invalidOutcome(
  meta: ProviderMetadata,
  detail: string,
  checks: readonly CheckOutcome[] = [],
): VerificationOutcome {
  return {
    status: 'invalido',
    provider: meta.id,
    independenceClass: meta.independenceClass,
    offline: true,
    checks,
    residualClaims: [],
    detail,
  };
}

/** `check` ergonómico para ir acumulando comprobaciones dentro de un `verify`. */
export function check(name: string, ok: boolean, detail: string): CheckOutcome {
  return { name, ok, detail };
}
