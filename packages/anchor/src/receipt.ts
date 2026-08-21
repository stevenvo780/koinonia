/**
 * Serialización canónica de los recibos.
 *
 * Un recibo viaja en un export público y se cita dentro del ledger. Las dos cosas exigen que tenga
 * **una sola** representación en bytes: si dos serializaciones honestas del mismo recibo pudieran
 * diferir, su hash dejaría de identificarlo y la cita del ledger no probaría nada. Es la misma razón
 * por la que existe JCS (§1.2), aplicada a un objeto que no es un evento.
 *
 * `parseReceipt` no se limita a parsear: **exige** que el texto sea exactamente su propia forma
 * canónica. Un recibo con las claves reordenadas o con un espacio de más no se «acomoda»: se
 * rechaza, porque no es el que se hasheó.
 */

import {
  canonicalize,
  canonicalizeToBytes,
  concatBytes,
  type JsonObject,
  parseCanonical,
  sha256,
} from '@koinonia/crypto';

import { type AnchorReceipt, assertAnchorReceipt } from './types.js';

/** Octeto de dominio del hash de un recibo. Ver `ANCHOR_DOMAIN` en `types.ts`. */
const RECEIPT_DOMAIN = 0x12;

export function receiptToJson(receipt: AnchorReceipt): JsonObject {
  return {
    provider: receipt.provider,
    independenceClass: receipt.independenceClass,
    checkpointHash: receipt.checkpointHash,
    externalRef: receipt.externalRef,
    submittedAt: receipt.submittedAt,
    ...(receipt.confirmedAt === undefined ? {} : { confirmedAt: receipt.confirmedAt }),
    ...(receipt.proof === undefined ? {} : { proof: receipt.proof }),
    raw: receipt.raw,
  };
}

export function canonicalReceipt(receipt: AnchorReceipt): string {
  return canonicalize(receiptToJson(receipt));
}

/** `SHA256(0x12 ‖ JCS_utf8(recibo))`. Es lo que se cita dentro del ledger. */
export async function receiptHash(receipt: AnchorReceipt): Promise<Uint8Array> {
  return sha256(
    concatBytes(Uint8Array.of(RECEIPT_DOMAIN), canonicalizeToBytes(receiptToJson(receipt))),
  );
}

/** Lee un recibo desde su texto canónico y valida su forma. Lanza si algo no cuadra. */
export function parseReceipt(text: string): AnchorReceipt {
  const parsed = parseCanonical(text);
  assertAnchorReceipt(parsed);
  return parsed;
}
