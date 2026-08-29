/**
 * Rectificación propia de datos declarativos (Ley 1581, art. 8 lit. a). La hermana de
 * `private-material-erasure.ts`.
 *
 * ═══ Por qué UNA sola fase, y no la autorización + ejecución que tiene la supresión ═══
 *
 * La supresión (ADR-0021) se parte en dos porque es irreversible: alguien pide, y un técnico
 * —humano, fuera de esta misma petición— consume esa autorización más tarde, lo que le da tiempo a
 * verificar que el sujeto es quien dice ser antes de un borrado del que no hay vuelta atrás
 * (ADR-0009 lo dice explícito: «obliga a un procedimiento de verificación de identidad serio ANTES
 * de ejecutar, no después»). Corregir un semestre o un alias no tiene esa clase de costo: si alguien
 * se equivoca al rectificar, **rectifica otra vez**, sin fricción de por medio. El propio marco
 * normativo del proyecto (`docs/research/20-normativa-datos-colombia.md` §1.3, fila RL-12) llama a
 * esto por su nombre —«autoservicio»— precisamente para el dato declarativo, y partirlo en
 * autorización + ejecución le impondría a un derecho de bajo riesgo el mismo costo que a uno
 * irreversible.
 *
 * ═══ Por qué el correo NO es uno de los tres campos ═══
 *
 * La fila RL-12 nombra el autoservicio para «programa, semestre, nombre de pila usado»: lo que la
 * persona declara de sí misma. El correo institucional no está en esa lista, y hay una razón
 * estructural para dejarlo fuera de este primer corte, no un olvido: acá el correo ES la credencial
 * de acceso —`upsertMember` (`identity.ts`) resuelve la sesión por `email_hash`— así que corregirlo
 * exige, sin negociar ninguna de las tres, (a) demostrar la posesión de la dirección nueva, con el
 * enlace de un solo uso que ya existe pero usado con otro propósito; (b) una sesión recién
 * autenticada, como ya exige `requestOwnErasure` para la supresión; y (c) revocar toda sesión
 * abierta al terminar, como ya hace `upsertMember` cuando cambia el nivel de privilegio (T-06).
 * Ninguna de las tres existe todavía para este flujo, y escribir el cambio de correo sin ellas es
 * exactamente lo que abrió la apropiación de cuenta que tumbó el primer intento de esta tarea. Se
 * prefiere dejarlo fuera y decirlo —en la propia pantalla, no sólo acá— a cumplir la letra completa
 * del artículo abriendo esa puerta.
 *
 * ═══ Por qué `semestre` y `jornada` sólo aceptan uno de un conjunto cerrado ═══
 *
 * Los dos son claves de estrato de una métrica PUBLICADA (`packages/metrics/src/cobertura.ts`, C11):
 * texto libre convierte «octavo», «8» y «s8» en tres estratos distintos, y —el agujero real que
 * tumbó el primer intento— dejaba escribir el propio identificador de miembro como «semestre», lo
 * que hace que `sellar()` lance `FugaDeIdentidadError` la primera vez que alguien pida la métrica, y
 * sin pantalla desde la que deshacerlo. `campoRectificable`/`SEMESTRES`/`JORNADAS` en
 * `@koinonia/contracts` ya lo impiden con `z.enum`; el `CHECK` de
 * `0014_rectificacion_datos_declarativos.sql` es el mismo candado del lado de la base, por si la
 * validación de entrada alguna vez dejara de aplicarse.
 *
 * ═══ Lo que sí se conserva del patrón de la supresión ═══
 *
 *  1. **La sesión ya autoriza.** No hay `subjectId` en la petición: quien llama a esta función
 *     recibe el sujeto ya resuelto (`sujetoPropioDe(request)` en `app.ts`), igual que `/mi/supresion`
 *     nunca acepta nombrar a otra persona.
 *  2. **Se anota un hecho nuevo; nunca se reescribe uno viejo.** El agregado `pii_rectification`
 *     nace con un único evento (`PIIRectificationApplied`) que dice CUÁNDO se corrigió y QUÉ CAMPO
 *     cambió — **nunca** el valor nuevo ni el viejo. El valor en sí vive y muere en la bóveda
 *     mutable (`identity.member`), nunca en el historial que no se puede alterar (ADR-0008): meter
 *     el alias corregido en el propio evento envenenaría para siempre el mismo historial que la
 *     separación de almacenes existe para mantener limpio.
 *  3. **La réplica se comprueba ANTES que el negocio — y ahora también contra el VALOR pedido.** El
 *     primer intento de esta tarea sólo comparaba sujeto y campo: un reintento con la MISMA clave de
 *     idempotencia pero OTRO valor nuevo se confundía con «ya aplicada» y devolvía 200 sin aplicar
 *     el segundo valor. Acá se guarda `valueHash` —una huella del valor, nunca el valor— en el
 *     propio evento, exactamente la misma disciplina que ya aplica `email_hash` en
 *     `identity.member`, y la réplica compara esa huella antes de devolver nada. Una clave reusada
 *     con otro valor dej a de ser una repetición silenciosa: es un conflicto (409), igual que ya lo
 *     es una clave reusada con otro campo o para otro sujeto.
 */

import { type CampoRectificable } from '@koinonia/contracts';
import { memberId, type MemberId } from '@koinonia/domain';

import {
  PG_ERROR,
  pgError,
  withTransaction,
  type PgPool,
  type PgPoolClient,
} from '../db/client.js';
import { appendWithin, lockLedgerWithin, readAppendRequestWithin } from '../ledger/event-store.js';
import { IdempotencyConflictError, type AppendedEvent } from '../ledger/types.js';
import { sha256Hex } from './identity.js';
import type { ClockPort, RandomPort } from './ports.js';

export const PII_RECTIFICATION_AGGREGATE_TYPE = 'pii_rectification';
export const PII_RECTIFICATION_APPLIED_EVENT = 'PIIRectificationApplied';

/** Única base legal aplicable: no hay selector en pantalla porque no hay nada que elegir. */
const LEGAL_BASIS = 'ley-1581-art-8a';

const CAMPOS: readonly CampoRectificable[] = ['alias', 'semestre', 'jornada'];

export class RectificationNoChangeError extends Error {
  readonly code = 'RECTIFICATION_NO_CHANGE' as const;
  constructor() {
    super('el valor nuevo coincide con el que ya está guardado');
    this.name = 'RectificationNoChangeError';
  }
}

/** El alias dejó de ser único por construcción en cuanto dejó de derivarse del correo (0014). */
export class RectificationAliasInUseError extends Error {
  readonly code = 'RECTIFICATION_ALIAS_IN_USE' as const;
  constructor() {
    super('ese alias ya lo usa otra persona');
    this.name = 'RectificationAliasInUseError';
  }
}

/**
 * Fallo cerrado: el sujeto desapareció entre la sesión y esta transacción, el generador de
 * identificadores devolvió algo que no vale, o el evento ya sellado no tiene la forma exacta que se
 * espera. Los tres casos son, a propósito, el mismo error: todos dicen «no se pudo, con seguridad, y
 * no se escribió nada», y distinguirlos no le serviría a quien lee la pantalla.
 */
export class RectificationUnavailableError extends Error {
  readonly code = 'RECTIFICATION_UNAVAILABLE' as const;
  constructor() {
    super('no se pudo aplicar la rectificación de forma segura');
    this.name = 'RectificationUnavailableError';
  }
}

export interface RequestOwnRectificationOptions {
  readonly clock: ClockPort;
  readonly random: RandomPort;
  readonly requestId: string;
  readonly field: CampoRectificable;
  readonly newValue: string;
}

export interface RectificationReceipt {
  readonly rectificationId: string;
  readonly claimRef: string;
  readonly field: CampoRectificable;
  readonly appliedAt: number;
  readonly subjectId: MemberId;
}

function validOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/u.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function eventPayload(event: Pick<AppendedEvent, 'event'>): Record<string, unknown> {
  const payload: unknown = event.event.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new RectificationUnavailableError();
  }
  return payload as Record<string, unknown>;
}

interface ParsedRectification {
  readonly rectificationId: string;
  readonly claimRef: string;
  readonly field: CampoRectificable;
  readonly appliedAt: number;
  readonly subjectId: MemberId;
  readonly valueHash: string;
}

/**
 * Parser estricto del único evento del agregado. Comparte la disciplina de `erasureRequestReceipt`
 * (`private-material-erasure.ts`): claves exactas, formas exactas, y ningún dato personal en el
 * resultado — `valueHash` es una huella, nunca el valor.
 */
function parseRectificationApplied(event: AppendedEvent): ParsedRectification {
  const payload = eventPayload(event);
  if (
    !validOpaqueId(event.event.aggregateId) ||
    event.event.aggregateType !== PII_RECTIFICATION_AGGREGATE_TYPE ||
    event.event.seq !== 0 ||
    event.event.eventType !== PII_RECTIFICATION_APPLIED_EVENT ||
    event.event.eventVersion !== 1 ||
    !exactKeys(payload, [
      'appliedAt',
      'claimRef',
      'eventId',
      'field',
      'legalBasis',
      'subjectId',
      'valueHash',
    ]) ||
    !validOpaqueId(payload['claimRef']) ||
    !validOpaqueId(payload['eventId']) ||
    !CAMPOS.some((campo) => campo === payload['field']) ||
    payload['legalBasis'] !== LEGAL_BASIS ||
    !Number.isSafeInteger(payload['appliedAt']) ||
    (payload['appliedAt'] as number) < 0 ||
    !validOpaqueId(payload['subjectId']) ||
    !validHash(payload['valueHash']) ||
    event.event.actor !== payload['subjectId'] ||
    Date.parse(event.event.occurredAt) !== payload['appliedAt']
  ) {
    throw new RectificationUnavailableError();
  }
  return {
    rectificationId: event.event.aggregateId,
    claimRef: payload['claimRef'],
    field: payload['field'] as CampoRectificable,
    appliedAt: payload['appliedAt'],
    subjectId: memberId(payload['subjectId']),
    valueHash: payload['valueHash'],
  };
}

/** El recibo público nunca lleva `valueHash`: es un detalle interno de la comprobación de réplica. */
function toReceipt(parsed: ParsedRectification): RectificationReceipt {
  return {
    rectificationId: parsed.rectificationId,
    claimRef: parsed.claimRef,
    field: parsed.field,
    appliedAt: parsed.appliedAt,
    subjectId: parsed.subjectId,
  };
}

function checkedOpaqueId(random: RandomPort): string {
  const value = random.opaqueId();
  if (!validOpaqueId(value)) throw new RectificationUnavailableError();
  return value;
}

/**
 * Huella del valor rectificado, nunca el valor. `field` entra como separador de dominio —el mismo
 * papel que cumple el prefijo de `wrapAad`/`capacityAad` en `adapters.ts`— para que «jornada:s3» y
 * «semestre:s3» no compartan huella sólo porque las cadenas concatenadas coincidirían sin él.
 */
function valueHashFor(field: CampoRectificable, value: string): string {
  return sha256Hex(`${field}\u0000${value}`);
}

interface DeclarativeRow {
  readonly alias: string;
  readonly semestre: string;
  readonly jornada: string;
}

function currentValueOf(row: DeclarativeRow, field: CampoRectificable): string {
  switch (field) {
    case 'alias':
      return row.alias;
    case 'semestre':
      return row.semestre;
    case 'jornada':
      return row.jornada;
  }
}

/**
 * Bloquea la fila del sujeto y lee sus tres campos declarativos en una sola consulta. El cerrojo es
 * `FOR UPDATE`: esta transacción va a escribir esa fila más abajo, y ya tomó el cerrojo global del
 * historial (`lockLedgerWithin`), así que no hay con quién correr — pero la fila igual se bloquea,
 * por la misma disciplina que sigue `capacity.ts::lockVaultSubjectWithin`.
 */
async function lockDeclarativeRowWithin(
  client: PgPoolClient,
  subjectId: MemberId,
): Promise<DeclarativeRow> {
  const { rows } = await client.query<DeclarativeRow>(
    `SELECT alias, semestre, jornada FROM identity.member WHERE member_id = $1 FOR UPDATE`,
    [subjectId],
  );
  const row = rows[0];
  // La sesión ya había resuelto a esta persona: que desaparezca entre la autenticación y esta
  // consulta es un estado transitorio, no una oportunidad para distinguir «no existe» de cualquier
  // otro motivo por el que no se pudo escribir con seguridad.
  if (row === undefined) throw new RectificationUnavailableError();
  return row;
}

/**
 * Aplica el cambio a la bóveda mutable. Nunca al historial: esa frontera —`identity` se corrige,
 * `governance` no se toca— es exactamente la que separa este fichero de uno que reescribiera el
 * pasado (ADR-0008).
 */
async function applyDeclarativeChangeWithin(
  client: PgPoolClient,
  subjectId: MemberId,
  field: CampoRectificable,
  value: string,
  now: number,
): Promise<void> {
  switch (field) {
    case 'alias':
      // La fecha es lo que hace que `upsertMember` deje de reafirmar el alias del proveedor de
      // identidad en el próximo enlace mágico (`0014_rectificacion_datos_declarativos.sql`,
      // `identity.ts`).
      await client.query(
        `UPDATE identity.member
            SET alias = $2, alias_declarado_en = to_timestamp($3::double precision / 1000)
          WHERE member_id = $1`,
        [subjectId, value, now],
      );
      return;
    case 'semestre':
      await client.query(`UPDATE identity.member SET semestre = $2 WHERE member_id = $1`, [
        subjectId,
        value,
      ]);
      return;
    case 'jornada':
      await client.query(`UPDATE identity.member SET jornada = $2 WHERE member_id = $1`, [
        subjectId,
        value,
      ]);
      return;
  }
}

/**
 * Rectificación de un dato declarativo propio (art. 8 lit. a, Ley 1581). Corrige de una vez —bóveda
 * y hecho nuevo, en la misma transacción— porque, a diferencia de la supresión, no hay nada
 * irreversible que autorizar por separado (ver la cabecera del fichero).
 */
export async function requestOwnRectification(
  pool: PgPool,
  subjectId: MemberId,
  options: RequestOwnRectificationOptions,
): Promise<RectificationReceipt> {
  return await withTransaction(pool, async (client) => {
    await lockLedgerWithin(client);
    const now = options.clock.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new RectificationUnavailableError();

    // `alias` sólo recorta espacios de más —ya lo hizo el esquema; esto es la misma defensa en
    // profundidad que el resto del servidor aplica a lo que ya validó el cliente—. `semestre` y
    // `jornada` no necesitan normalizarse: son uno de un conjunto cerrado, sin variantes de forma.
    const value = options.field === 'alias' ? options.newValue.trim() : options.newValue;
    const expectedValueHash = valueHashFor(options.field, value);

    // Réplica ANTES que nada: ver la nota (3) de la cabecera del fichero. Comparar también el
    // valor —vía su huella— es lo que distingue un reintento de red de una segunda intención bajo
    // la misma clave.
    const replay = await readAppendRequestWithin(client, options.requestId, 'public');
    if (replay !== undefined) {
      try {
        if (replay.events.length !== 1) throw new Error('lote divergente');
        const replayEvent = replay.events[0];
        if (replayEvent === undefined) throw new Error('lote vacío');
        const parsed = parseRectificationApplied(replayEvent);
        if (
          parsed.subjectId !== subjectId ||
          parsed.field !== options.field ||
          parsed.valueHash !== expectedValueHash
        ) {
          throw new Error('solicitud divergente');
        }
        return toReceipt(parsed);
      } catch {
        throw new IdempotencyConflictError(
          options.requestId,
          'ya identifica otra acción, otro sujeto o otro valor',
        );
      }
    }

    const row = await lockDeclarativeRowWithin(client, subjectId);
    if (currentValueOf(row, options.field) === value) throw new RectificationNoChangeError();

    try {
      await applyDeclarativeChangeWithin(client, subjectId, options.field, value, now);
    } catch (error) {
      // Sólo la UNIQUE del alias se traduce: cualquier otro fallo del motor sigue su camino normal
      // hacia el `500` genérico, en vez de mentir con «ese alias ya existe».
      const info = pgError(error);
      const esAliasDuplicado =
        info?.code === PG_ERROR.uniqueViolation &&
        info.constraint === 'identity_member_alias_lower_key';
      if (esAliasDuplicado) throw new RectificationAliasInUseError();
      throw error;
    }

    const rectificationId = checkedOpaqueId(options.random);
    const eventId = checkedOpaqueId(options.random);
    const claimRef = checkedOpaqueId(options.random);
    if (new Set([rectificationId, eventId, claimRef]).size !== 3) {
      throw new RectificationUnavailableError();
    }

    const result = await appendWithin(client, {
      aggregateId: rectificationId,
      aggregateType: PII_RECTIFICATION_AGGREGATE_TYPE,
      expectedHead: { kind: 'new' },
      requestId: options.requestId,
      requestScope: 'public',
      events: [
        {
          eventType: PII_RECTIFICATION_APPLIED_EVENT,
          eventVersion: 1,
          occurredAt: new Date(now).toISOString(),
          actor: subjectId,
          payload: {
            eventId,
            appliedAt: now,
            field: options.field,
            legalBasis: LEGAL_BASIS,
            claimRef,
            subjectId,
            valueHash: expectedValueHash,
          },
        },
      ],
    });
    const stored = result.events[0];
    if (stored === undefined) throw new RectificationUnavailableError();
    return toReceipt(parseRectificationApplied(stored));
  });
}
