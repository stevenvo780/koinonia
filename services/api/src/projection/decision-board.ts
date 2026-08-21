/**
 * Proyección `tablero_decisiones`: la vista de lectura del estado de cada decisión.
 *
 * Es **determinista a propósito**. Ningún manejador de aquí llama a `now()`, a `random()` ni depende
 * del orden de iteración de un `Set`: hasta `updated_at` se toma del `occurredAt` del evento, no del
 * reloj del proceso. Sin eso, reconstruir la proyección produciría una tabla ligeramente distinta
 * cada vez y la señal 4 del §5.4 —la diferencia contra una reconstrucción en sombra— daría falsas
 * alarmas para siempre, hasta que alguien la apagara.
 */

import type { PgClient } from '../db/client.js';
import { DECISION_AGGREGATE_TYPE, decodeDecisionEvent } from '../decision/codec.js';
import type { StoredEvent } from '../ledger/types.js';
import type { ProjectionHandler } from './tracker.js';

export const DECISION_BOARD = 'tablero_decisiones';

/** Columnas que SÍ son estado proyectado. `updated_at` es derivada del evento, así que también. */
export const DECISION_BOARD_COLUMNS = [
  'decision_id',
  'status',
  'summary',
  'round',
  'ballots_cast',
  'distinct_voters',
  'opened_at',
  'closed_at',
  'close_cause',
  'outcome_kind',
  'result_hash',
  'last_leaf',
  'updated_at',
] as const;

async function upsert(
  client: PgClient,
  decisionId: string,
  patch: Readonly<Record<string, unknown>>,
  leafIndex: bigint,
  occurredAt: string,
): Promise<void> {
  const keys = Object.keys(patch);
  const columns = ['decision_id', 'last_leaf', 'updated_at', ...keys];
  const values: unknown[] = [
    decisionId,
    leafIndex.toString(),
    occurredAt,
    ...keys.map((k) => patch[k]),
  ];
  const placeholders = columns.map((_, i) => `$${String(i + 1)}`);
  const updates = ['last_leaf = EXCLUDED.last_leaf', 'updated_at = EXCLUDED.updated_at'].concat(
    keys.map((key) => `${key} = EXCLUDED.${key}`),
  );
  await client.query(
    `INSERT INTO projection.decision_board (${columns.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (decision_id) DO UPDATE SET ${updates.join(', ')}`,
    values,
  );
}

/**
 * El manejador.
 *
 * Sólo mira eventos de agregados de tipo `decision`: la espina, los checkpoints y cualquier otro
 * agregado pasan de largo sin tocarla. Un manejador que se tropiece con un evento que no entiende
 * debe **ignorarlo**, no fallar: el ledger crecerá con tipos nuevos y una proyección vieja tiene que
 * seguir sirviendo hasta que alguien la actualice.
 */
export const decisionBoardHandler: ProjectionHandler = {
  name: DECISION_BOARD,

  async reset(client: PgClient): Promise<void> {
    await client.query('DELETE FROM projection.decision_voter');
    await client.query('DELETE FROM projection.decision_board');
  },

  async apply(client: PgClient, stored: StoredEvent): Promise<void> {
    if (stored.event.aggregateType !== DECISION_AGGREGATE_TYPE) return;
    const input = decodeDecisionEvent(stored);
    const decisionId: string = input.decisionId;
    const at = stored.event.occurredAt;
    const payload = input.payload;

    switch (payload.type) {
      case 'DecisionDrafted':
        await upsert(
          client,
          decisionId,
          { status: 'Draft', summary: payload.draft.summary, round: 1 },
          stored.leafIndex,
          at,
        );
        return;

      case 'DecisionOpened':
        await upsert(
          client,
          decisionId,
          { status: 'Open', opened_at: at, round: 1 },
          stored.leafIndex,
          at,
        );
        return;

      case 'BallotCast': {
        await client.query(
          `INSERT INTO projection.decision_voter (decision_id, voter, ballots)
           VALUES ($1, $2, 1)
           ON CONFLICT (decision_id, voter) DO UPDATE
             SET ballots = projection.decision_voter.ballots + 1`,
          [decisionId, payload.ballot.voter],
        );
        const { rows } = await client.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM projection.decision_voter WHERE decision_id = $1',
          [decisionId],
        );
        await client.query(
          `UPDATE projection.decision_board
              SET ballots_cast = ballots_cast + 1,
                  distinct_voters = $2::int,
                  last_leaf = $3::bigint,
                  updated_at = $4
            WHERE decision_id = $1`,
          [decisionId, rows[0]?.n ?? '0', stored.leafIndex.toString(), at],
        );
        return;
      }

      case 'RoundOpened':
        await upsert(client, decisionId, { round: payload.round }, stored.leafIndex, at);
        return;

      case 'DecisionClosed':
        await upsert(
          client,
          decisionId,
          { status: 'Closed', closed_at: at, close_cause: payload.cause },
          stored.leafIndex,
          at,
        );
        return;

      case 'ResultComputed':
        await upsert(
          client,
          decisionId,
          {
            status: 'Tallied',
            outcome_kind: payload.outcomeKind,
            result_hash: payload.resultHash,
          },
          stored.leafIndex,
          at,
        );
        return;

      case 'DecisionRatified':
        await upsert(client, decisionId, { status: 'Ratified' }, stored.leafIndex, at);
        return;

      case 'DecisionRejected':
        await upsert(client, decisionId, { status: 'Rejected' }, stored.leafIndex, at);
        return;

      case 'DecisionAnnulled':
        await upsert(client, decisionId, { status: 'Annulled' }, stored.leafIndex, at);
        return;

      default:
        // Los demás eventos existen en el ledger y no cambian este tablero. Ignorarlos es
        // deliberado: una proyección que falla ante un tipo que no conoce deja de servir la web
        // entera por un evento que no le incumbe.
        return;
    }
  },
};

export interface DecisionBoardRow {
  readonly decision_id: string;
  readonly status: string;
  readonly summary: string | null;
  readonly round: number;
  readonly ballots_cast: number;
  readonly distinct_voters: number;
  readonly opened_at: string | null;
  readonly closed_at: string | null;
  readonly close_cause: string | null;
  readonly outcome_kind: string | null;
  readonly result_hash: string | null;
  readonly last_leaf: string;
  readonly updated_at: string;
}

/** Vuelca la proyección entera en orden estable, para poder compararla contra una reconstrucción. */
export async function dumpDecisionBoard(client: PgClient): Promise<readonly DecisionBoardRow[]> {
  const { rows } = await client.query<DecisionBoardRow>(
    `SELECT decision_id, status, summary, round, ballots_cast, distinct_voters,
            opened_at::text AS opened_at, closed_at::text AS closed_at, close_cause,
            outcome_kind, result_hash, last_leaf::text AS last_leaf, updated_at::text AS updated_at
       FROM projection.decision_board ORDER BY decision_id`,
  );
  return rows;
}
