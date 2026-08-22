/** Almacenamiento transaccional de aperturas textuales restringidas (ADR-0045). */

import { timingSafeEqual } from 'node:crypto';

import {
  canonicalBytes,
  createPrivateMaterialCommitment,
  type EventId,
  type InitiativeLog,
  initiativeId,
  memberId,
  type MemberId,
  type PrivateMaterialCommitment,
  type PrivateMaterialContext,
  toPrivateMaterialCommitment,
} from '@koinonia/domain';

import { toBytes, toText, type PgClient, type PgPoolClient } from '../db/client.js';
import { readStream } from '../ledger/event-store.js';
import type { StoredEvent } from '../ledger/types.js';
import { verifyAggregate } from '../ledger/verify.js';
import {
  ensureSubjectDataKeyWithin,
  lockVaultSubjectForReadWithin,
  lockVaultSubjectWithin,
  readSubjectDataKeyWithin,
} from './capacity.js';
import { MAX_RESTRICTED_PRIVATE_TEXT_BYTES } from './ports.js';
import type {
  PrivateMaterialPurpose,
  RandomPort,
  RestrictedTextMaterialOpening,
  VaultCryptoPort,
} from './ports.js';

const PURPOSES: ReadonlySet<string> = new Set([
  'task-block-detail',
  'task-help-detail',
  'task-evidence-object',
  'task-delivery-summary',
  'task-change-detail',
]);

/** Fallo de entrada estable, sin repetir el contenido privado recibido. */
export class InvalidPrivateMaterialInputError extends Error {
  constructor() {
    super('el material privado no cumple el contrato textual restringido');
    this.name = 'InvalidPrivateMaterialInputError';
  }
}

/** Ausencia, falta de acceso, sustitución y fallo criptográfico comparten una salida opaca. */
export class PrivateMaterialUnavailableError extends Error {
  constructor() {
    super('el material privado no está disponible');
    this.name = 'PrivateMaterialUnavailableError';
  }
}

/** La supresión no puede declarar verificado un conjunto faltante, huérfano o inauténtico. */
export class PrivateMaterialSuppressionUnavailableError extends Error {
  constructor() {
    super('el material privado no está en condiciones de registrar una supresión verificable');
    this.name = 'PrivateMaterialSuppressionUnavailableError';
  }
}

export interface CreateRestrictedTextMaterialInput {
  /** Identificador opaco elegido antes del evento; normalmente el ID del hecho que lo compromete. */
  readonly materialId: string;
  readonly ownerId: MemberId;
  readonly context: PrivateMaterialContext;
  readonly content: string;
  readonly createdAt: number;
}

export interface CreatedRestrictedTextMaterial {
  readonly materialId: string;
  readonly commitment: PrivateMaterialCommitment;
}

export interface OpenRestrictedTextMaterialInput {
  readonly materialId: string;
  readonly ownerId: MemberId;
  readonly expectedContext: PrivateMaterialContext;
  readonly expectedCommitment: PrivateMaterialCommitment;
}

interface PrivateMaterialRow {
  readonly material_id?: unknown;
  readonly owner_id?: unknown;
  readonly key_ref: unknown;
  readonly purpose: unknown;
  readonly nonce: unknown;
  readonly ciphertext: unknown;
  readonly created_at?: unknown;
}

function validOpaqueId(value: string): boolean {
  return /^[0-9a-f]{32}$/u.test(value);
}

function purpose(value: unknown): PrivateMaterialPurpose {
  if (typeof value !== 'string' || !PURPOSES.has(value)) {
    throw new PrivateMaterialUnavailableError();
  }
  return value as PrivateMaterialPurpose;
}

function assertRestrictedTextInput(input: CreateRestrictedTextMaterialInput): void {
  if (
    !validOpaqueId(input.materialId) ||
    typeof input.content !== 'string' ||
    Buffer.byteLength(input.content, 'utf8') < 1 ||
    Buffer.byteLength(input.content, 'utf8') > MAX_RESTRICTED_PRIVATE_TEXT_BYTES ||
    !Number.isSafeInteger(input.createdAt) ||
    input.createdAt < 0 ||
    input.context.visibility !== 'restricted' ||
    !PURPOSES.has(input.context.purpose)
  ) {
    throw new InvalidPrivateMaterialInputError();
  }
}

function snapshotContext(context: PrivateMaterialContext): PrivateMaterialContext {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(canonicalBytes(context));
    const snapshot: unknown = JSON.parse(decoded);
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
      throw new InvalidPrivateMaterialInputError();
    }
    return snapshot as PrivateMaterialContext;
  } catch {
    throw new InvalidPrivateMaterialInputError();
  }
}

function sameCanonical(left: unknown, right: unknown): boolean {
  try {
    return Buffer.from(canonicalBytes(left)).equals(Buffer.from(canonicalBytes(right)));
  } catch {
    return false;
  }
}

function sameCommitment(
  actual: PrivateMaterialCommitment,
  expected: PrivateMaterialCommitment,
): boolean {
  const left = Buffer.from(actual, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Crea y persiste una apertura dentro de la transacción del caller.
 *
 * Si el mismo flujo también añade un evento, debe haber tomado primero el cerrojo del ledger. Esta
 * función toma después `identity.member FOR UPDATE`, reutiliza/crea la DSK y no hace COMMIT propio.
 */
export async function createRestrictedTextMaterialWithin(
  client: PgPoolClient,
  vault: VaultCryptoPort,
  random: RandomPort,
  input: CreateRestrictedTextMaterialInput,
): Promise<CreatedRestrictedTextMaterial> {
  assertRestrictedTextInput(input);
  if (!vault.available) throw new PrivateMaterialUnavailableError();

  const context = snapshotContext(input.context);
  const nonce = Uint8Array.from(random.bytes(16));
  if (nonce.length !== 16) throw new InvalidPrivateMaterialInputError();
  const opening: RestrictedTextMaterialOpening = {
    nonce128: Buffer.from(nonce).toString('hex'),
    context,
    content: input.content,
  };

  try {
    const commitment = await createPrivateMaterialCommitment({
      nonce,
      context,
      content: input.content,
    });
    await lockVaultSubjectWithin(client, input.ownerId);
    const subjectKey = await ensureSubjectDataKeyWithin(client, vault, input.ownerId);
    const sealed = await vault.encryptRestrictedTextMaterial({
      subjectId: input.ownerId,
      materialId: input.materialId,
      purpose: context.purpose,
      opening,
      subjectKey,
    });
    await client.query(
      `INSERT INTO identity.private_material
         (material_id, owner_id, key_ref, purpose, nonce, ciphertext, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7::double precision / 1000))`,
      [
        input.materialId,
        input.ownerId,
        subjectKey.keyRef,
        context.purpose,
        Buffer.from(sealed.nonce),
        Buffer.from(sealed.ciphertext),
        input.createdAt,
      ],
    );
    return { materialId: input.materialId, commitment };
  } catch (error) {
    if (error instanceof InvalidPrivateMaterialInputError) throw error;
    throw new PrivateMaterialUnavailableError();
  } finally {
    nonce.fill(0);
  }
}

/**
 * Abre sólo la fila del dueño esperado y verifica contexto + commitment antes de devolver texto.
 * No distingue ausencia, otro dueño, ciphertext movido, tag inválido ni compromiso obsoleto.
 */
export async function openRestrictedTextMaterialWithin(
  client: PgPoolClient,
  vault: VaultCryptoPort,
  input: OpenRestrictedTextMaterialInput,
): Promise<RestrictedTextMaterialOpening> {
  try {
    if (
      !vault.available ||
      !validOpaqueId(input.materialId) ||
      input.expectedContext.visibility !== 'restricted'
    ) {
      throw new PrivateMaterialUnavailableError();
    }
    toPrivateMaterialCommitment(input.expectedCommitment);
    await lockVaultSubjectForReadWithin(client, input.ownerId);
    const { rows } = await client.query<PrivateMaterialRow>(
      `SELECT key_ref, purpose, nonce, ciphertext
         FROM identity.private_material
        WHERE material_id = $1 AND owner_id = $2`,
      [input.materialId, input.ownerId],
    );
    const row = rows[0];
    if (row === undefined) throw new PrivateMaterialUnavailableError();
    const storedPurpose = purpose(row.purpose);
    if (storedPurpose !== input.expectedContext.purpose) {
      throw new PrivateMaterialUnavailableError();
    }
    const subjectKey = await readSubjectDataKeyWithin(client, input.ownerId);
    if (subjectKey === undefined) throw new PrivateMaterialUnavailableError();
    const keyRef = toText(row.key_ref, 'identity.private_material.key_ref').trimEnd();
    if (keyRef !== subjectKey.keyRef) throw new PrivateMaterialUnavailableError();
    const opening = await vault.decryptRestrictedTextMaterial({
      subjectId: input.ownerId,
      materialId: input.materialId,
      purpose: storedPurpose,
      nonce: toBytes(row.nonce, 'identity.private_material.nonce'),
      ciphertext: toBytes(row.ciphertext, 'identity.private_material.ciphertext'),
      subjectKey,
    });
    if (!sameCanonical(opening.context, input.expectedContext)) {
      throw new PrivateMaterialUnavailableError();
    }
    const actualCommitment = await createPrivateMaterialCommitment({
      nonce: Buffer.from(opening.nonce128, 'hex'),
      context: opening.context,
      content: opening.content,
    });
    if (!sameCommitment(actualCommitment, input.expectedCommitment)) {
      throw new PrivateMaterialUnavailableError();
    }
    return opening;
  } catch {
    throw new PrivateMaterialUnavailableError();
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Auditoría interna de disponibilidad y correspondencia
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export type PrivateMaterialFindingCode =
  | 'ambiguous-ledger-link'
  | 'invalid-ledger-link'
  | 'invalid-suppression'
  | 'ambiguous-suppression'
  | 'invalid-erasure-request'
  | 'unauthorized-suppression'
  | 'authorization-link-mismatch'
  | 'requested-subject-missing'
  | 'material-missing'
  | 'orphan-material'
  | 'suppressed-material-still-present'
  | 'suppressed-subject-still-present'
  | 'material-coordinate-mismatch'
  | 'material-opening-invalid'
  | 'vault-unavailable'
  | 'verification-unavailable';

export interface PrivateMaterialFinding {
  readonly code: PrivateMaterialFindingCode;
  /** Texto fijo y sanitizado: nunca incluye contenido, dueño, clave ni error del proveedor. */
  readonly detail: string;
}

export interface PrivateMaterialVerification {
  readonly ok: boolean;
  readonly expectedCount: number;
  readonly storedCount: number;
  readonly openedCount: number;
  readonly suppressedCount: number;
  readonly findings: readonly PrivateMaterialFinding[];
}

/** Un agregado por solicitud: seq 0 autoriza y seq 1 ejecuta; el técnico nunca elige sujeto. */
export const PII_ERASURE_AGGREGATE_TYPE = 'pii_erasure';
export const PII_ERASURE_REQUESTED_EVENT = 'PIIErasureRequested';
export const PII_ERASURE_EXECUTED_EVENT = 'PIIErased';
export const PII_ERASURE_AUTHORIZATION_KIND = 'self-fresh-session-v1';
export const PII_ERASURE_LEGAL_BASES = ['ley-1581-art-8e', 'revocatoria-consentimiento'] as const;

interface PrivateMaterialSuppression {
  readonly subjectId: MemberId;
  readonly materialIds: readonly string[];
}

interface PiiErasureRequest {
  readonly subjectId: MemberId;
  readonly eventId: string;
  readonly eventHash: string;
  readonly requestedAt: number;
}

interface ExpectedPrivateMaterial {
  readonly materialId: string;
  readonly ownerId: MemberId;
  readonly context: PrivateMaterialContext;
  readonly commitment: PrivateMaterialCommitment;
  readonly createdAt: number;
}

function privateFinding(code: PrivateMaterialFindingCode, detail: string): PrivateMaterialFinding {
  return { code, detail };
}

function expectedPrivateMaterials(logs: readonly InitiativeLog[]): {
  readonly expected: ReadonlyMap<string, ExpectedPrivateMaterial>;
  readonly findings: readonly PrivateMaterialFinding[];
} {
  const expected = new Map<string, ExpectedPrivateMaterial>();
  const findings: PrivateMaterialFinding[] = [];

  for (const log of logs) {
    const deliveryOffers = new Map<string, EventId>();
    for (const event of log) {
      const payload = event.payload;
      if (payload.type === 'TaskDelivered') {
        deliveryOffers.set(event.eventId, payload.offerId);
      }

      let context: PrivateMaterialContext | undefined;
      let commitment: PrivateMaterialCommitment | undefined;
      if (payload.type === 'TaskBlocked' && payload.privateDetailCommitment !== undefined) {
        context = {
          purpose: 'task-block-detail',
          initiativeId: initiativeId(event.aggregateId),
          taskId: payload.taskId,
          offerId: payload.offerId,
          visibility: 'restricted',
        };
        commitment = payload.privateDetailCommitment;
      } else if (
        payload.type === 'TaskHelpRequested' &&
        payload.privateDetailCommitment !== undefined
      ) {
        context = {
          purpose: 'task-help-detail',
          initiativeId: initiativeId(event.aggregateId),
          taskId: payload.taskId,
          offerId: payload.offerId,
          visibility: 'restricted',
        };
        commitment = payload.privateDetailCommitment;
      } else if (payload.type === 'TaskEvidenceAdded' && payload.visibility === 'restricted') {
        context = {
          purpose: 'task-evidence-object',
          initiativeId: initiativeId(event.aggregateId),
          taskId: payload.taskId,
          offerId: payload.offerId,
          visibility: 'restricted',
        };
        commitment = payload.objectCommitment;
      } else if (payload.type === 'TaskDelivered') {
        context = {
          purpose: 'task-delivery-summary',
          initiativeId: initiativeId(event.aggregateId),
          taskId: payload.taskId,
          offerId: payload.offerId,
          deliveryId: event.eventId,
          visibility: 'restricted',
        };
        commitment = payload.summaryCommitment;
      } else if (
        payload.type === 'TaskChangesRequested' &&
        payload.privateDetailCommitment !== undefined
      ) {
        const offerId = deliveryOffers.get(payload.deliveryId);
        if (offerId === undefined) {
          findings.push(
            privateFinding(
              'invalid-ledger-link',
              'un compromiso privado de revisión no enlaza una entrega anterior válida',
            ),
          );
          continue;
        }
        context = {
          purpose: 'task-change-detail',
          initiativeId: initiativeId(event.aggregateId),
          taskId: payload.taskId,
          offerId,
          deliveryId: payload.deliveryId,
          visibility: 'restricted',
        };
        commitment = payload.privateDetailCommitment;
      }

      if (context === undefined || commitment === undefined) continue;
      if (event.actor === 'system') {
        findings.push(
          privateFinding(
            'invalid-ledger-link',
            'un compromiso privado no identifica a la persona que conserva su apertura',
          ),
        );
        continue;
      }
      if (expected.has(event.eventId)) {
        findings.push(
          privateFinding(
            'ambiguous-ledger-link',
            'una misma identidad de evento pretende identificar más de un material privado',
          ),
        );
        continue;
      }
      expected.set(event.eventId, {
        materialId: event.eventId,
        ownerId: event.actor,
        context,
        commitment,
        createdAt: event.occurredAt,
      });
    }
  }
  return { expected, findings };
}

function exactPayloadKeys(payload: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(payload).sort().join('\0') === [...keys].sort().join('\0');
}

function canonicalPayload(event: StoredEvent): Record<string, unknown> | undefined {
  const payload: unknown = event.event.payload;
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : undefined;
}

function parseErasureRequest(event: StoredEvent): PiiErasureRequest | undefined {
  const payload = canonicalPayload(event);
  const subjectId = payload?.['subjectId'];
  const eventId = payload?.['eventId'];
  const claimRef = payload?.['claimRef'];
  const requestedAt = payload?.['requestedAt'];
  const eventHash = Buffer.from(event.eventHash).toString('hex');
  if (
    event.event.aggregateType !== PII_ERASURE_AGGREGATE_TYPE ||
    event.event.seq !== 0 ||
    event.event.eventType !== PII_ERASURE_REQUESTED_EVENT ||
    event.event.eventVersion !== 1 ||
    payload === undefined ||
    !exactPayloadKeys(payload, [
      'authorizationKind',
      'claimRef',
      'eventId',
      'legalBasis',
      'requestedAt',
      'subjectId',
    ]) ||
    payload['authorizationKind'] !== PII_ERASURE_AUTHORIZATION_KIND ||
    typeof claimRef !== 'string' ||
    !validOpaqueId(claimRef) ||
    typeof eventId !== 'string' ||
    !validOpaqueId(eventId) ||
    !PII_ERASURE_LEGAL_BASES.some((basis) => basis === payload['legalBasis']) ||
    !Number.isSafeInteger(requestedAt) ||
    (requestedAt as number) < 0 ||
    typeof subjectId !== 'string' ||
    !validOpaqueId(subjectId) ||
    event.event.actor !== subjectId ||
    Date.parse(event.event.occurredAt) !== requestedAt ||
    !/^[0-9a-f]{64}$/u.test(eventHash)
  ) {
    return undefined;
  }
  return {
    subjectId: memberId(subjectId),
    eventId,
    eventHash,
    requestedAt,
  };
}

function parseSuppression(
  event: StoredEvent,
  request: PiiErasureRequest,
): PrivateMaterialSuppression | undefined {
  const payload = canonicalPayload(event);
  const subjectId = payload?.['subjectId'];
  const eventId = payload?.['eventId'];
  const materialIds = payload?.['materialIds'];
  const executedAt = payload?.['executedAt'];
  if (
    event.event.aggregateType !== PII_ERASURE_AGGREGATE_TYPE ||
    event.event.seq !== 1 ||
    event.event.eventType !== PII_ERASURE_EXECUTED_EVENT ||
    event.event.eventVersion !== 1 ||
    event.event.actor !== undefined ||
    payload === undefined ||
    !exactPayloadKeys(payload, [
      'eventId',
      'executedAt',
      'materialIds',
      'requestEventHash',
      'requestEventId',
      'subjectId',
    ]) ||
    typeof eventId !== 'string' ||
    !validOpaqueId(eventId) ||
    !Number.isSafeInteger(executedAt) ||
    (executedAt as number) < request.requestedAt ||
    Date.parse(event.event.occurredAt) !== executedAt ||
    subjectId !== request.subjectId ||
    payload['requestEventId'] !== request.eventId ||
    payload['requestEventHash'] !== request.eventHash ||
    !Array.isArray(materialIds) ||
    !materialIds.every(
      (value): value is string => typeof value === 'string' && validOpaqueId(value),
    ) ||
    new Set(materialIds).size !== materialIds.length ||
    [...materialIds].sort().some((value, index) => value !== materialIds[index])
  ) {
    return undefined;
  }
  return { subjectId: request.subjectId, materialIds };
}

async function readSuppressions(client: PgClient): Promise<{
  readonly byMaterial: ReadonlyMap<string, MemberId>;
  readonly subjects: ReadonlySet<MemberId>;
  readonly pendingSubjects: ReadonlySet<MemberId>;
  readonly findings: readonly PrivateMaterialFinding[];
}> {
  const findings: PrivateMaterialFinding[] = [];
  const byMaterial = new Map<string, MemberId>();
  const subjects = new Set<MemberId>();
  const pendingSubjects = new Set<MemberId>();
  const { rows } = await client.query<{ aggregate_id: unknown }>(
    `SELECT DISTINCT aggregate_id
       FROM governance.event
      WHERE aggregate_type = $1 OR event_type IN ($2, $3)
      ORDER BY aggregate_id`,
    [PII_ERASURE_AGGREGATE_TYPE, PII_ERASURE_REQUESTED_EVENT, PII_ERASURE_EXECUTED_EVENT],
  );
  for (const row of rows) {
    const aggregateId = toText(row.aggregate_id, 'governance.event.aggregate_id').trimEnd();
    let stream: readonly StoredEvent[];
    try {
      const verification = await verifyAggregate(client, aggregateId);
      if (!verification.ok) throw new Error('cadena inválida');
      stream = await readStream(client, aggregateId);
    } catch {
      findings.push(
        privateFinding(
          'invalid-erasure-request',
          'una solicitud de supresión no conserva una cadena append-only válida',
        ),
      );
      continue;
    }
    const first = stream[0];
    const request = first === undefined ? undefined : parseErasureRequest(first);
    if (request === undefined) {
      findings.push(
        privateFinding(
          stream.some((event) => event.event.eventType === PII_ERASURE_EXECUTED_EVENT)
            ? 'unauthorized-suppression'
            : 'invalid-erasure-request',
          'una supresión no está precedida por una solicitud propia autenticada del titular',
        ),
      );
      continue;
    }
    if (stream.length === 1) {
      pendingSubjects.add(request.subjectId);
      continue;
    }
    if (stream.length !== 2) {
      findings.push(
        privateFinding(
          'invalid-suppression',
          'un agregado de supresión contiene eventos adicionales o fuera de orden',
        ),
      );
      continue;
    }
    const second = stream[1];
    const suppression = second === undefined ? undefined : parseSuppression(second, request);
    if (suppression === undefined) {
      findings.push(
        privateFinding(
          'authorization-link-mismatch',
          'la ejecución no referencia la identidad y huella exactas de la solicitud propia',
        ),
      );
      continue;
    }
    if (subjects.has(suppression.subjectId)) {
      findings.push(
        privateFinding(
          'ambiguous-suppression',
          'un mismo sujeto aparece en más de una ejecución de supresión',
        ),
      );
    }
    subjects.add(suppression.subjectId);
    for (const materialId of suppression.materialIds) {
      if (byMaterial.has(materialId)) {
        findings.push(
          privateFinding(
            'ambiguous-suppression',
            'un mismo material privado aparece en más de una declaración de supresión',
          ),
        );
        continue;
      }
      byMaterial.set(materialId, suppression.subjectId);
    }
  }
  return { byMaterial, subjects, pendingSubjects, findings };
}

function storedInstant(value: unknown): number | undefined {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.getTime() : undefined;
}

async function verifyOpeningAgainstExpected(
  client: PgClient,
  vault: VaultCryptoPort,
  row: PrivateMaterialRow,
  expected: ExpectedPrivateMaterial,
): Promise<boolean> {
  const ownerId = toText(row.owner_id, 'identity.private_material.owner_id').trimEnd();
  const keyRef = toText(row.key_ref, 'identity.private_material.key_ref').trimEnd();
  const storedPurpose = purpose(row.purpose);
  if (
    ownerId !== expected.ownerId ||
    storedPurpose !== expected.context.purpose ||
    storedInstant(row.created_at) !== expected.createdAt
  ) {
    return false;
  }
  const subjectKey = await readSubjectDataKeyWithin(client, expected.ownerId);
  if (subjectKey === undefined || subjectKey.keyRef !== keyRef) return false;
  const opening = await vault.decryptRestrictedTextMaterial({
    subjectId: expected.ownerId,
    materialId: expected.materialId,
    purpose: storedPurpose,
    nonce: toBytes(row.nonce, 'identity.private_material.nonce'),
    ciphertext: toBytes(row.ciphertext, 'identity.private_material.ciphertext'),
    subjectKey,
  });
  if (!sameCanonical(opening.context, expected.context)) return false;
  const actualCommitment = await createPrivateMaterialCommitment({
    nonce: Buffer.from(opening.nonce128, 'hex'),
    context: opening.context,
    content: opening.content,
  });
  return sameCommitment(actualCommitment, expected.commitment);
}

/**
 * Fija el conjunto exacto que una supresión legal va a destruir.
 *
 * El caller ya posee `ledger → member FOR UPDATE`, de modo que entre esta autenticación y el
 * `DELETE` no puede aparecer otra apertura. Una anomalía no se transforma en tombstone verde: se
 * rechaza con una causa opaca y la transacción queda intacta.
 */
export async function privateMaterialsForSuppressionWithin(
  client: PgClient,
  vault: VaultCryptoPort,
  initiativeLogs: readonly InitiativeLog[],
  subjectId: MemberId,
): Promise<readonly string[]> {
  try {
    const derived = expectedPrivateMaterials(initiativeLogs);
    if (derived.findings.length > 0) throw new PrivateMaterialSuppressionUnavailableError();
    const expected = [...derived.expected.values()]
      .filter((material) => material.ownerId === subjectId)
      .sort((left, right) =>
        left.materialId < right.materialId ? -1 : left.materialId > right.materialId ? 1 : 0,
      );
    const { rows } = await client.query<PrivateMaterialRow>(
      `SELECT material_id, owner_id, key_ref, purpose, nonce, ciphertext, created_at
         FROM identity.private_material
        WHERE owner_id = $1
        ORDER BY material_id`,
      [subjectId],
    );
    if (rows.length !== expected.length || (!vault.available && rows.length > 0)) {
      throw new PrivateMaterialSuppressionUnavailableError();
    }
    const expectedById = new Map(expected.map((material) => [material.materialId, material]));
    for (const row of rows) {
      const materialId = toText(row.material_id, 'identity.private_material.material_id').trimEnd();
      const material = expectedById.get(materialId);
      if (
        material === undefined ||
        !(await verifyOpeningAgainstExpected(client, vault, row, material))
      ) {
        throw new PrivateMaterialSuppressionUnavailableError();
      }
    }
    return expected.map((material) => material.materialId);
  } catch (error) {
    if (error instanceof PrivateMaterialSuppressionUnavailableError) throw error;
    throw new PrivateMaterialSuppressionUnavailableError();
  }
}

/**
 * Audita la parte mutable que un export público no puede abrir.
 *
 * Corre dentro del mismo snapshot `REPEATABLE READ READ ONLY` que el ledger. No toma ni asciende
 * locks: las filas, sus DSK y los eventos pertenecen a una sola foto. El resultado sólo contiene
 * contadores y códigos sanitizados; ni contenido ni PII salen de la bóveda.
 */
export async function verifyRestrictedPrivateMaterialsWithin(
  client: PgClient,
  vault: VaultCryptoPort,
  initiativeLogs: readonly InitiativeLog[],
): Promise<PrivateMaterialVerification> {
  const derived = expectedPrivateMaterials(initiativeLogs);
  const findings = [...derived.findings];
  const suppressions = await readSuppressions(client);
  findings.push(...suppressions.findings);
  const validSuppressions = new Map<string, MemberId>();
  for (const [materialId, subjectId] of suppressions.byMaterial) {
    const expected = derived.expected.get(materialId);
    if (expected === undefined || expected.ownerId !== subjectId) {
      findings.push(
        privateFinding(
          'invalid-suppression',
          'una declaración de supresión no corresponde al dueño y compromiso históricos',
        ),
      );
      continue;
    }
    validSuppressions.set(materialId, subjectId);
  }
  if (suppressions.subjects.size > 0) {
    const { rows: survivingSubjects } = await client.query<{ member_id: unknown }>(
      `SELECT member_id FROM identity.member
        WHERE member_id = ANY($1::char(32)[])
        ORDER BY member_id`,
      [[...suppressions.subjects]],
    );
    for (const _row of survivingSubjects) {
      findings.push(
        privateFinding(
          'suppressed-subject-still-present',
          'una supresión privada fue declarada pero el registro de identidad todavía existe',
        ),
      );
    }
  }
  if (suppressions.pendingSubjects.size > 0) {
    const { rows: existingSubjects } = await client.query<{ member_id: unknown }>(
      `SELECT member_id FROM identity.member
        WHERE member_id = ANY($1::char(32)[])
        ORDER BY member_id`,
      [[...suppressions.pendingSubjects]],
    );
    const existing = new Set(
      existingSubjects.map((row) => toText(row.member_id, 'identity.member.member_id').trimEnd()),
    );
    for (const subjectId of suppressions.pendingSubjects) {
      if (!existing.has(subjectId)) {
        findings.push(
          privateFinding(
            'requested-subject-missing',
            'una solicitud pendiente perdió su identidad antes de una ejecución autorizada',
          ),
        );
      }
    }
  }
  const { rows } = await client.query<PrivateMaterialRow>(
    `SELECT material_id, owner_id, key_ref, purpose, nonce, ciphertext, created_at
       FROM identity.private_material
      ORDER BY material_id`,
  );
  const stored = new Map<string, PrivateMaterialRow>();
  for (const row of rows) {
    const materialId = toText(row.material_id, 'identity.private_material.material_id').trimEnd();
    stored.set(materialId, row);
    if (validSuppressions.has(materialId)) {
      findings.push(
        privateFinding(
          'suppressed-material-still-present',
          'una apertura declarada como suprimida todavía conserva ciphertext en la bóveda',
        ),
      );
    } else if (!derived.expected.has(materialId)) {
      findings.push(
        privateFinding(
          'orphan-material',
          'la bóveda contiene un material privado sin evento y compromiso correspondientes',
        ),
      );
    }
  }

  let suppressedCount = 0;
  for (const materialId of derived.expected.keys()) {
    if (validSuppressions.has(materialId)) {
      suppressedCount++;
    } else if (!stored.has(materialId)) {
      findings.push(
        privateFinding(
          'material-missing',
          'un compromiso del ledger no conserva la apertura privada que declara disponible',
        ),
      );
    }
  }

  const openingsExpected = derived.expected.size - suppressedCount;
  if (!vault.available && (openingsExpected > 0 || stored.size > 0)) {
    findings.push(
      privateFinding(
        'vault-unavailable',
        'la comprobación privada no pudo autenticarse porque la bóveda no está disponible',
      ),
    );
    return {
      ok: false,
      expectedCount: derived.expected.size,
      storedCount: stored.size,
      openedCount: 0,
      suppressedCount,
      findings,
    };
  }

  let openedCount = 0;
  for (const [materialId, expected] of derived.expected) {
    if (validSuppressions.has(materialId)) continue;
    const row = stored.get(materialId);
    if (row === undefined) continue;
    try {
      if (await verifyOpeningAgainstExpected(client, vault, row, expected)) {
        openedCount++;
      } else {
        findings.push(
          privateFinding(
            'material-coordinate-mismatch',
            'una fila privada no coincide con el evento, contexto o compromiso que la identifica',
          ),
        );
      }
    } catch {
      findings.push(
        privateFinding(
          'material-opening-invalid',
          'una apertura privada no pudo autenticarse o no reproduce su compromiso',
        ),
      );
    }
  }

  return {
    ok: findings.length === 0,
    expectedCount: derived.expected.size,
    storedCount: stored.size,
    openedCount,
    suppressedCount,
    findings,
  };
}

/** Resultado rojo estable cuando ni siquiera puede ejecutarse la auditoría interna. */
export function unavailablePrivateMaterialVerification(): PrivateMaterialVerification {
  return {
    ok: false,
    expectedCount: 0,
    storedCount: 0,
    openedCount: 0,
    suppressedCount: 0,
    findings: [
      privateFinding(
        'verification-unavailable',
        'la comprobación interna del material privado no pudo completarse',
      ),
    ],
  };
}
