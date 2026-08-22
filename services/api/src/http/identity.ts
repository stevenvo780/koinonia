/**
 * La bóveda de identidad: personas, enlaces mágicos y sesiones.
 *
 * Es el **único** módulo del repositorio que toca datos personales, y todo lo que hace está pensado
 * para que ese hecho no se filtre a ninguna otra parte. Devuelve `MemberId` opacos hacia arriba; el
 * correo no cruza esta frontera.
 *
 * ═══ Enlace mágico: un solo uso, con caducidad y resistente a la reproducción ═══
 *
 * Tres propiedades, y las tres tienen su mecanismo:
 *
 *  1. **Del token no se guarda el token.** Se guarda `sha256(token)`. Quien lea la base no entra
 *     como nadie: de la huella no se vuelve al token.
 *  2. **Caducidad**: `expires_at`, comprobado contra el reloj inyectado. Quince minutos.
 *  3. **Un solo uso, de verdad**: consumir es `UPDATE … WHERE token_hash = $1 AND consumed_at IS
 *     NULL RETURNING …`, una comparación-y-cambio **atómica**. Dos peticiones simultáneas con el
 *     mismo enlace producen exactamente un ganador porque lo decide el motor de la base, no una
 *     lectura seguida de una escritura. Ese hueco entre leer y escribir es precisamente el que un
 *     ataque de reproducción explota, y aquí no existe.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import {
  type CircleId,
  circleId,
  type MemberId,
  memberId,
  type Role,
  isRole,
} from '@koinonia/domain';

import { type PgClient, type PgPool, withTransaction } from '../db/client.js';
import { appendWithin, lockLedgerWithin, readAppendRequestWithin } from '../ledger/event-store.js';
import { IdempotencyConflictError } from '../ledger/types.js';
import {
  erasureRequestReceipt,
  type ErasureRequestReceipt,
  type PiiErasureLegalBasis,
} from './private-material-erasure.js';
import {
  PII_ERASURE_AGGREGATE_TYPE,
  PII_ERASURE_AUTHORIZATION_KIND,
  PII_ERASURE_REQUESTED_EVENT,
} from './private-material-store.js';
import type { AuthenticatedMember, ClockPort, IdentityClaim, RandomPort } from './ports.js';

/** Cuánto dura un enlace mágico. Se dice en pantalla: los plazos no se ocultan. */
export const ENLACE_VIGENCIA_MS = 15 * 60 * 1000;
/** Cuánto dura una sesión. Un semestre no; un día de trabajo sí. */
export const SESION_VIGENCIA_MS = 12 * 60 * 60 * 1000;
/** Una supresión irreversible exige que la sesión se haya abierto en los últimos diez minutos. */
export const ERASURE_FRESH_SESSION_MS = 10 * 60 * 1000;

export class ErasureReauthenticationRequiredError extends Error {
  constructor() {
    super('la supresión exige una sesión recién autenticada');
    this.name = 'ErasureReauthenticationRequiredError';
  }
}

export class ErasureAlreadyRequestedError extends Error {
  constructor() {
    super('ya existe una solicitud de supresión para este sujeto');
    this.name = 'ErasureAlreadyRequestedError';
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Comparación en tiempo constante de dos huellas hexadecimales de la misma longitud. */
export function huellasIguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Token opaco de 256 bits en base64url. No lleva información: es un puntero a una fila. */
export function nuevoToken(random: RandomPort): string {
  return Buffer.from(random.bytes(32)).toString('base64url');
}

interface MemberRow {
  readonly member_id: string;
  readonly alias: string;
  readonly roles: string[];
  readonly circles: string[];
  readonly semestre: string;
  readonly jornada: string;
  readonly enrolled_at: Date;
  readonly withdrawn_at: Date | null;
}

export interface MemberRecord {
  readonly memberId: MemberId;
  readonly alias: string;
  readonly roles: readonly Role[];
  readonly circles: readonly CircleId[];
  readonly semestre: string;
  readonly jornada: string;
  readonly enrolledAt: number;
  readonly withdrawnAt: number | undefined;
}

function toRecord(row: MemberRow): MemberRecord {
  return {
    memberId: memberId(row.member_id.trimEnd()),
    alias: row.alias,
    // Un rol desconocido en la base no se acepta «por si acaso»: se descarta. Si alguien escribiera
    // 'superadmin' en la columna, no querríamos que el sistema le diera un permiso sin nombre.
    roles: row.roles.filter((r): r is Role => isRole(r)),
    circles: row.circles.map((c) => circleId(c.trimEnd())),
    semestre: row.semestre,
    jornada: row.jornada,
    enrolledAt: row.enrolled_at.getTime(),
    withdrawnAt: row.withdrawn_at === null ? undefined : row.withdrawn_at.getTime(),
  };
}

const MEMBER_COLUMNS =
  'member_id, alias, roles, circles, semestre, jornada, enrolled_at, withdrawn_at';

/**
 * Alta o actualización de una persona a partir de lo que afirma el proveedor de identidad.
 *
 * El `member_id` se genera **una sola vez**, con 128 bits del generador criptográfico, y no se
 * deriva del correo (ADR-0006): un identificador derivado es re-derivable por cualquiera que tenga
 * el correo, lo que sobre 300 personas permite confirmar pertenencia por diccionario y vuelve
 * ficticio el borrado.
 */
export async function upsertMember(
  client: PgClient,
  claim: IdentityClaim,
  ports: { readonly random: RandomPort; readonly clock: ClockPort },
): Promise<MemberRecord> {
  const emailHash = sha256Hex(claim.email);
  const { rows } = await client.query<MemberRow>(
    `INSERT INTO identity.member
       (member_id, email, email_hash, alias, roles, circles, semestre, jornada, enrolled_at)
     VALUES ($1, $2, $3, $4, $5::text[], $6::char(32)[], $7, $8,
             to_timestamp($9::double precision / 1000))
     ON CONFLICT (email_hash) DO UPDATE
       SET alias = EXCLUDED.alias,
           roles = EXCLUDED.roles,
           circles = EXCLUDED.circles
     RETURNING ${MEMBER_COLUMNS}`,
    [
      ports.random.opaqueId(),
      claim.email,
      emailHash,
      claim.alias,
      [...claim.roles],
      [...claim.circles],
      claim.semestre,
      claim.jornada,
      ports.clock.now(),
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('el alta de la persona no devolvió fila');
  return toRecord(row);
}

export async function findMember(
  client: PgClient,
  id: MemberId,
): Promise<MemberRecord | undefined> {
  const { rows } = await client.query<MemberRow>(
    `SELECT ${MEMBER_COLUMNS} FROM identity.member WHERE member_id = $1`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? undefined : toRecord(row);
}

/**
 * Relee y bloquea suavemente la matrícula vigente que una mutación va a atribuir. El bloqueo evita
 * aceptar una tarea para alguien que se retiró entre la lectura de la interfaz y el append.
 */
export async function findActiveMemberInCircleForShare(
  client: PgClient,
  id: MemberId,
  circle: CircleId,
  now: number,
): Promise<MemberRecord | undefined> {
  const { rows } = await client.query<MemberRow>(
    `SELECT ${MEMBER_COLUMNS} FROM identity.member
      WHERE member_id = $1
        AND enrolled_at <= to_timestamp($3::double precision / 1000)
        AND (withdrawn_at IS NULL OR withdrawn_at > to_timestamp($3::double precision / 1000))
        AND $2::char(32) = ANY(circles)
      FOR SHARE`,
    [id, circle, now],
  );
  const row = rows[0];
  return row === undefined ? undefined : toRecord(row);
}

/** Selector mínimo de miembros vigentes del círculo; nunca es un directorio de identidades. */
export async function listActiveCircleMembers(
  client: PgClient,
  circle: CircleId,
  now: number,
): Promise<readonly { readonly id: MemberId; readonly alias: string }[]> {
  const { rows } = await client.query<{ member_id: string; alias: string }>(
    `SELECT member_id, alias FROM identity.member
      WHERE enrolled_at <= to_timestamp($2::double precision / 1000)
        AND (withdrawn_at IS NULL OR withdrawn_at > to_timestamp($2::double precision / 1000))
        AND $1::char(32) = ANY(circles)
      ORDER BY member_id ASC`,
    [circle, now],
  );
  return rows.map((row) => ({ id: memberId(row.member_id.trimEnd()), alias: row.alias }));
}

/** Todo el registro vivo, en orden de identificador. Es la entrada de la congelación del padrón. */
export async function allMembers(client: PgClient, now: number): Promise<readonly MemberRecord[]> {
  const { rows } = await client.query<MemberRow>(
    `SELECT ${MEMBER_COLUMNS} FROM identity.member
      WHERE enrolled_at <= to_timestamp($1::double precision / 1000)
        AND (withdrawn_at IS NULL OR withdrawn_at > to_timestamp($1::double precision / 1000))
      ORDER BY member_id ASC`,
    [now],
  );
  return rows.map(toRecord);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Enlace mágico
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface EnlaceEmitido {
  readonly token: string;
  readonly expiraEn: number;
}

export async function issueMagicLink(
  client: PgClient,
  member: MemberRecord,
  ports: { readonly clock: ClockPort; readonly random: RandomPort },
): Promise<EnlaceEmitido> {
  const token = nuevoToken(ports.random);
  const expiraEn = ports.clock.now() + ENLACE_VIGENCIA_MS;
  await client.query(
    `INSERT INTO identity.magic_link (token_hash, member_id, issued_at, expires_at)
     VALUES ($1, $2, to_timestamp($3::double precision / 1000), to_timestamp($4::double precision / 1000))`,
    [sha256Hex(token), member.memberId, ports.clock.now(), expiraEn],
  );
  return { token, expiraEn };
}

export type CanjeResultado =
  | { readonly ok: true; readonly memberId: MemberId }
  | { readonly ok: false; readonly code: 'ENLACE_INVALIDO' | 'ENLACE_VENCIDO' | 'ENLACE_YA_USADO' };

/**
 * Canjea el enlace. **Un solo uso, con caducidad y resistente a la reproducción.**
 *
 * El `UPDATE … WHERE consumed_at IS NULL RETURNING` es la pieza entera: es atómico, así que dos
 * intentos simultáneos con el mismo token producen un ganador y un perdedor, y el perdedor no
 * consigue una sesión. Después se distingue «vencido» de «ya usado» **releyendo la fila**, para dar
 * un mensaje útil sin haber relajado la atomicidad.
 */
export async function redeemMagicLink(
  client: PgClient,
  token: string,
  clock: ClockPort,
): Promise<CanjeResultado> {
  const tokenHash = sha256Hex(token);
  const now = clock.now();

  const claimed = await client.query<{ member_id: string }>(
    `UPDATE identity.magic_link
        SET consumed_at = to_timestamp($2::double precision / 1000)
      WHERE token_hash = $1
        AND consumed_at IS NULL
        AND expires_at > to_timestamp($2::double precision / 1000)
      RETURNING member_id`,
    [tokenHash, now],
  );

  const row = claimed.rows[0];
  if (row !== undefined) return { ok: true, memberId: memberId(row.member_id.trimEnd()) };

  // No se pudo consumir. Ahora sí se puede leer sin carrera: la fila, si existe, ya no es
  // consumible por nadie, así que el diagnóstico es estable.
  const { rows } = await client.query<{ consumed: boolean; expired: boolean }>(
    `SELECT consumed_at IS NOT NULL AS consumed,
            expires_at <= to_timestamp($2::double precision / 1000) AS expired
       FROM identity.magic_link WHERE token_hash = $1`,
    [tokenHash, now],
  );
  const estado = rows[0];
  if (estado === undefined) return { ok: false, code: 'ENLACE_INVALIDO' };
  if (estado.consumed) return { ok: false, code: 'ENLACE_YA_USADO' };
  return { ok: false, code: 'ENLACE_VENCIDO' };
}

/** Barre los enlaces vencidos. Un enlace caducado que sigue en la base es un dato sin propósito. */
export async function purgeExpiredLinks(client: PgClient, clock: ClockPort): Promise<number> {
  const result = await client.query(
    `DELETE FROM identity.magic_link
      WHERE expires_at < to_timestamp($1::double precision / 1000)`,
    [clock.now() - ENLACE_VIGENCIA_MS],
  );
  return result.rowCount ?? 0;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Sesión
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface SesionEmitida {
  readonly token: string;
  readonly expiraEn: number;
}

export async function openSession(
  client: PgClient,
  id: MemberId,
  ports: { readonly clock: ClockPort; readonly random: RandomPort },
): Promise<SesionEmitida> {
  const token = nuevoToken(ports.random);
  const expiraEn = ports.clock.now() + SESION_VIGENCIA_MS;
  await client.query(
    `INSERT INTO identity.session (token_hash, member_id, issued_at, expires_at)
     VALUES ($1, $2, to_timestamp($3::double precision / 1000), to_timestamp($4::double precision / 1000))`,
    [sha256Hex(token), id, ports.clock.now(), expiraEn],
  );
  return { token, expiraEn };
}

interface SessionRow extends MemberRow {
  readonly issued_at: Date;
  readonly expires_at: Date;
}

/** Resuelve una sesión a la persona. Devuelve `undefined` si no vale, sin decir por qué. */
export async function resolveSession(
  client: PgClient,
  token: string,
  clock: ClockPort,
): Promise<AuthenticatedMember | undefined> {
  const { rows } = await client.query<SessionRow>(
    `SELECT m.member_id, m.alias, m.roles, m.circles, m.semestre, m.jornada,
            m.enrolled_at, m.withdrawn_at, s.issued_at, s.expires_at
       FROM identity.session s
       JOIN identity.member m ON m.member_id = s.member_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > to_timestamp($2::double precision / 1000)
        AND m.enrolled_at <= to_timestamp($2::double precision / 1000)
        AND (m.withdrawn_at IS NULL OR m.withdrawn_at > to_timestamp($2::double precision / 1000))`,
    [sha256Hex(token), clock.now()],
  );
  const row = rows[0];
  if (row === undefined) return undefined;
  const record = toRecord(row);
  return {
    memberId: record.memberId,
    alias: record.alias,
    roles: record.roles,
    circles: record.circles,
    expiresAt: row.expires_at.getTime(),
  };
}

export async function revokeSession(
  client: PgClient,
  token: string,
  clock: ClockPort,
): Promise<void> {
  await client.query(
    `UPDATE identity.session
        SET revoked_at = to_timestamp($2::double precision / 1000)
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [sha256Hex(token), clock.now()],
  );
}

export interface RequestOwnErasureOptions {
  readonly clock: ClockPort;
  readonly random: RandomPort;
  readonly requestId: string;
  readonly legalBasis: PiiErasureLegalBasis;
  readonly confirmationIrreversible: boolean;
}

async function resolveFreshErasureSession(
  client: PgClient,
  token: string,
  now: number,
): Promise<MemberRecord> {
  const { rows } = await client.query<SessionRow>(
    `SELECT m.member_id, m.alias, m.roles, m.circles, m.semestre, m.jornada,
            m.enrolled_at, m.withdrawn_at, s.issued_at, s.expires_at
       FROM identity.session s
       JOIN identity.member m ON m.member_id = s.member_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > to_timestamp($2::double precision / 1000)
        AND s.issued_at >= to_timestamp($3::double precision / 1000)
        AND m.enrolled_at <= to_timestamp($2::double precision / 1000)
        AND (m.withdrawn_at IS NULL OR m.withdrawn_at > to_timestamp($2::double precision / 1000))
      FOR SHARE OF m, s`,
    [sha256Hex(token), now, now - ERASURE_FRESH_SESSION_MS],
  );
  const row = rows[0];
  if (row === undefined) throw new ErasureReauthenticationRequiredError();
  return toRecord(row);
}

function checkedOpaqueId(random: RandomPort): string {
  const value = random.opaqueId();
  if (!/^[0-9a-f]{32}$/u.test(value)) throw new ErasureReauthenticationRequiredError();
  return value;
}

/**
 * Solicitud autoservicio durable (ADR-0021).
 *
 * No acepta `subjectId`: lo deriva otra vez del token dentro de la transacción y exige una sesión
 * de menos de diez minutos. El técnico recibirá sólo `erasureId` y derivará el sujeto de seq 0.
 */
export async function requestOwnErasure(
  pool: PgPool,
  sessionToken: string,
  options: RequestOwnErasureOptions,
): Promise<ErasureRequestReceipt> {
  return await withTransaction(pool, async (client) => {
    await lockLedgerWithin(client);
    const now = options.clock.now();
    if (
      !options.confirmationIrreversible ||
      !Number.isSafeInteger(now) ||
      now < 0 ||
      !Number.isFinite(new Date(now).getTime())
    ) {
      throw new ErasureReauthenticationRequiredError();
    }
    const member = await resolveFreshErasureSession(client, sessionToken, now);

    const replay = await readAppendRequestWithin(client, options.requestId, 'public');
    if (replay !== undefined) {
      try {
        if (replay.events.length !== 1) throw new Error('lote divergente');
        const replayEvent = replay.events[0];
        if (replayEvent === undefined) throw new Error('lote vacío');
        const receipt = erasureRequestReceipt(replayEvent, true);
        if (receipt.subjectId !== member.memberId || receipt.legalBasis !== options.legalBasis) {
          throw new Error('solicitud divergente');
        }
        return receipt;
      } catch {
        throw new IdempotencyConflictError(
          options.requestId,
          'ya identifica otra acción o una solicitud de otro sujeto',
        );
      }
    }

    const prior = await client.query(
      `SELECT 1 FROM governance.event
        WHERE aggregate_type = $1 AND event_type = $2 AND actor = $3
        LIMIT 1`,
      [PII_ERASURE_AGGREGATE_TYPE, PII_ERASURE_REQUESTED_EVENT, member.memberId],
    );
    if (prior.rows[0] !== undefined) throw new ErasureAlreadyRequestedError();

    const erasureId = checkedOpaqueId(options.random);
    const requestEventId = checkedOpaqueId(options.random);
    const claimRef = checkedOpaqueId(options.random);
    if (new Set([erasureId, requestEventId, claimRef]).size !== 3) {
      throw new ErasureReauthenticationRequiredError();
    }
    const result = await appendWithin(client, {
      aggregateId: erasureId,
      aggregateType: PII_ERASURE_AGGREGATE_TYPE,
      expectedHead: { kind: 'new' },
      requestId: options.requestId,
      requestScope: 'public',
      events: [
        {
          eventType: PII_ERASURE_REQUESTED_EVENT,
          eventVersion: 1,
          occurredAt: new Date(now).toISOString(),
          actor: member.memberId,
          payload: {
            authorizationKind: PII_ERASURE_AUTHORIZATION_KIND,
            claimRef,
            eventId: requestEventId,
            legalBasis: options.legalBasis,
            requestedAt: now,
            subjectId: member.memberId,
          },
        },
      ],
    });
    const stored = result.events[0];
    if (stored === undefined) throw new ErasureReauthenticationRequiredError();
    return erasureRequestReceipt(stored, false);
  });
}
