/**
 * Un ciclo de anclaje completo: enviar, madurar, verificar, evaluar el quórum y **dejar constancia**.
 *
 * La regla que gobierna este fichero: **ninguna falla se traga**. Un proveedor que revienta, un
 * recibo ilegible, un sello que no madura — todo produce un evento `AnclajeFallido` en el ledger y
 * un descarte explícito en el veredicto. El silencio es el único resultado prohibido: un anclaje que
 * falla en silencio es peor que no tener anclaje, porque la portada seguiría en verde.
 */

import { fromHex, toHex } from '@koinonia/crypto';

import {
  type AnchorEventDraft,
  anchorConfirmed,
  anchorFailed,
  anchorStatePublished,
  eventsForSubmission,
} from './events.js';
import { evaluateQuorum, type AnchorEvidence, evidenceOf, type QuorumVerdict } from './quorum.js';
import { receiptHash } from './receipt.js';
import type { AnchorProvider, AnchorReceipt, CheckpointRef, VerificationOutcome } from './types.js';

/** Puerto de escritura en el ledger. La implementación real vive en `services/api`. */
export interface AnchorLedgerPort {
  registrar(events: readonly AnchorEventDraft[]): Promise<void>;
}

/** Puerto que no hace nada. Útil para simular un ciclo sin tocar la base. */
export const NULL_LEDGER: AnchorLedgerPort = { registrar: () => Promise.resolve() };

export interface AnchorCycleInput {
  readonly checkpoint: CheckpointRef;
  readonly providers: readonly AnchorProvider[];
  readonly ledger?: AnchorLedgerPort;
  /** Instante del ciclo, RFC 3339 UTC. Inyectado: aquí no se lee el reloj. */
  readonly now: string;
  /** Recibos de ciclos anteriores para este checkpoint. Se reverifican y se intenta madurarlos. */
  readonly existing?: readonly AnchorReceipt[];
  /** `true` ⇒ se llama a `poll()` de los proveedores que lo tengan. Necesita red. */
  readonly poll?: boolean;
}

export interface AnchorAttemptResult {
  readonly provider: string;
  readonly receipt: AnchorReceipt | undefined;
  readonly outcome: VerificationOutcome | undefined;
  readonly error: string | undefined;
}

export interface AnchorCycleResult {
  readonly attempts: readonly AnchorAttemptResult[];
  readonly receipts: readonly AnchorReceipt[];
  readonly verdict: QuorumVerdict;
  /** Eventos escritos en el agregado `#anclaje`, en orden. */
  readonly events: readonly AnchorEventDraft[];
}

export async function runAnchorCycle(input: AnchorCycleInput): Promise<AnchorCycleResult> {
  const { checkpoint, providers, now } = input;
  const checkpointHash = checkpoint.checkpointHash;
  const checkpointHex = toHex(checkpointHash);
  const ledger = input.ledger ?? NULL_LEDGER;

  const events: AnchorEventDraft[] = [];
  const attempts: AnchorAttemptResult[] = [];
  const receipts: AnchorReceipt[] = [];
  const evidence: AnchorEvidence[] = [];

  for (const provider of providers) {
    const meta = provider.meta;
    const previous = (input.existing ?? []).find(
      (candidate) => candidate.provider === meta.id && candidate.checkpointHash === checkpointHex,
    );

    let receipt: AnchorReceipt | undefined = previous;
    if (receipt === undefined) {
      try {
        receipt = await provider.submit(checkpointHash);
        events.push(
          eventsForSubmission({ treeSize: checkpoint.treeSize, receipt, occurredAt: now }),
        );
      } catch (error) {
        const motivo = `no se pudo enviar el anclaje: ${describe(error)}`;
        events.push(
          anchorFailed({
            treeSize: checkpoint.treeSize,
            checkpointHash: checkpointHex,
            provider: meta.id,
            independenceClass: meta.independenceClass,
            motivo,
            occurredAt: now,
          }),
        );
        attempts.push({ provider: meta.id, receipt: undefined, outcome: undefined, error: motivo });
        evidence.push({
          provider: meta.id,
          independenceClass: meta.independenceClass,
          status: 'pendiente',
          signingKeyOffHost: meta.signingKeyOffHost,
          checkpointHash: checkpointHex,
        });
        continue;
      }
    }

    if (input.poll === true && provider.poll !== undefined) {
      try {
        receipt = await provider.poll(receipt);
      } catch (error) {
        events.push(
          anchorFailed({
            treeSize: checkpoint.treeSize,
            checkpointHash: checkpointHex,
            provider: meta.id,
            independenceClass: meta.independenceClass,
            motivo: `no se pudo madurar el anclaje: ${describe(error)}`,
            occurredAt: now,
          }),
        );
      }
    }

    let outcome: VerificationOutcome;
    try {
      outcome = await provider.verify(receipt, checkpointHash);
    } catch (error) {
      const motivo = `la verificación del recibo lanzó: ${describe(error)}`;
      events.push(
        anchorFailed({
          treeSize: checkpoint.treeSize,
          checkpointHash: checkpointHex,
          provider: meta.id,
          independenceClass: meta.independenceClass,
          motivo,
          occurredAt: now,
        }),
      );
      attempts.push({ provider: meta.id, receipt, outcome: undefined, error: motivo });
      receipts.push(receipt);
      evidence.push({
        provider: meta.id,
        independenceClass: meta.independenceClass,
        status: 'invalido',
        signingKeyOffHost: meta.signingKeyOffHost,
        checkpointHash: receipt.checkpointHash,
      });
      continue;
    }

    receipts.push(receipt);
    attempts.push({ provider: meta.id, receipt, outcome, error: undefined });
    evidence.push(evidenceOf(meta, outcome, receipt.checkpointHash));

    if (outcome.status === 'confirmado') {
      events.push(
        anchorConfirmed({
          treeSize: checkpoint.treeSize,
          checkpointHash: checkpointHex,
          provider: meta.id,
          independenceClass: meta.independenceClass,
          externalRef: receipt.externalRef,
          receiptHash: await receiptHash(receipt),
          ...(outcome.attestedAt === undefined ? {} : { attestedAt: outcome.attestedAt }),
          occurredAt: now,
        }),
      );
    } else if (outcome.status === 'invalido') {
      events.push(
        anchorFailed({
          treeSize: checkpoint.treeSize,
          checkpointHash: checkpointHex,
          provider: meta.id,
          independenceClass: meta.independenceClass,
          motivo: outcome.detail,
          occurredAt: now,
        }),
      );
    }
  }

  const verdict = evaluateQuorum(evidence, {
    checkpointHash: checkpointHex,
    issuedAt: checkpoint.issuedAt,
    now,
  });

  events.push(
    anchorStatePublished({
      treeSize: checkpoint.treeSize,
      checkpointHash: checkpointHex,
      verdict,
      occurredAt: now,
    }),
  );

  await ledger.registrar(events);

  return { attempts, receipts, verdict, events };
}

/** Construye un `CheckpointRef` desde su forma hexadecimal (la del export). */
export function checkpointRefFromHex(input: {
  readonly treeSize: bigint;
  readonly rootHash: string;
  readonly headsRoot: string;
  readonly checkpointHash: string;
  readonly issuedAt: string;
}): CheckpointRef {
  return {
    treeSize: input.treeSize,
    rootHash: fromHex(input.rootHash),
    headsRoot: fromHex(input.headsRoot),
    checkpointHash: fromHex(input.checkpointHash),
    issuedAt: input.issuedAt,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
