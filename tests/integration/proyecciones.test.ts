/**
 * Proyecciones desechables: reconstrucción y detección de desincronización (§5).
 *
 * La propiedad central es que reconstruir desde `leaf_index = 0` produzca **el mismo estado**, campo
 * a campo, que haber aplicado los eventos uno a uno según llegaban. Si no lo produjera, el manejador
 * no sería determinista, y un manejador no determinista convierte la señal 4 del §5.4 —la diferencia
 * contra una reconstrucción en sombra— en una falsa alarma permanente. Así es como se acaban
 * apagando los detectores.
 *
 * Los eventos que se proyectan son los de un recorrido de decisión **real**, producido por el motor
 * de `@koinonia/domain`: proyectar eventos inventados sólo demostraría que el proyector sabe leer lo
 * que el propio test escribió.
 */

import {
  append,
  catchUp,
  DECISION_BOARD,
  decisionBoardHandler,
  dumpDecisionBoard,
  persistDecisionLog,
  projectionStatus,
  rebuild,
  verifyLedger,
  type PgPool,
} from '@koinonia/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildFullDecision, DECISION_ID } from './helpers/decision-fixture.js';
import { id32, iso, ledgerEnv, ready, requestId, skipNote } from './helpers/ledger-env.js';

const env = await ledgerEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

/** Segunda decisión, sólo con su borrador: sirve para comprobar que el tablero lista varias. */
const DECISION_B = id32('proyeccion-b');

describe.skipIf(!env.ok)(`proyecciones desechables${skipNote(env)}`, () => {
  let pool: PgPool;

  beforeAll(async () => {
    pool = ready(env).appPool;

    const fixture = await buildFullDecision();
    await persistDecisionLog(pool, fixture.log, { requestId: requestId('proj-flujo') });

    await append(pool, {
      aggregateId: DECISION_B,
      aggregateType: 'decision',
      expectedHead: { kind: 'new' },
      requestId: requestId('proj-b'),
      events: [
        {
          eventType: 'DecisionDrafted',
          occurredAt: iso(10),
          payload: {
            eventId: id32('ev-b-1'),
            body: {
              draft: {
                proposalId: id32('propuesta-b'),
                proposalVersionHash: '22'.repeat(32),
                summary: 'Asignar la sala 12-303 los martes',
              },
            },
          },
        },
      ],
    });
  });

  it('la proyección se pone al día y refleja el ledger', async () => {
    const resultado = await catchUp(pool, decisionBoardHandler);
    expect(resultado.applied).toBeGreaterThan(0);

    const tablero = await dumpDecisionBoard(pool);
    expect(tablero).toHaveLength(2);

    const principal = tablero.find((r) => r.decision_id === DECISION_ID);
    expect(principal).toBeDefined();
    expect(principal?.status).toBe('Tallied');
    expect(principal?.summary).toBe('Aprobar el acta de la asamblea anterior');
    expect(principal?.ballots_cast).toBe(5);
    expect(principal?.distinct_voters).toBe(5);
    expect(principal?.close_cause).toBe('window');
    expect(principal?.outcome_kind).toBe('approved');
    expect(principal?.result_hash).toMatch(/^[0-9a-f]{64}$/u);

    const otra = tablero.find((r) => r.decision_id === DECISION_B);
    expect(otra?.status).toBe('Draft');
  });

  it('ignora sin fallar los eventos que no le incumben (espina, AgregadoAbierto)', async () => {
    // La espina y sus `AgregadoAbierto` pasan por el mismo `catchUp`. Una proyección que fallara
    // ante un tipo que no conoce dejaría de servir la web entera por un evento que no le importa.
    const estado = await projectionStatus(pool, DECISION_BOARD);
    expect(estado.lag).toBe(0n);
    expect(estado.foldMatches).toBe(true);
    expect(estado.ledgerContiguous).toBe(true);
  });

  it('RECONSTRUIR DESDE CERO produce exactamente el mismo estado', async () => {
    const antes = await dumpDecisionBoard(pool);
    const estadoAntes = await projectionStatus(pool, DECISION_BOARD);

    const resultado = await rebuild(pool, decisionBoardHandler);
    expect(resultado.applied).toBeGreaterThan(0);

    const despues = await dumpDecisionBoard(pool);
    // Igualdad estructural completa, incluido `updated_at`: es el `occurredAt` del último evento
    // aplicado y NO el reloj del proceso, justamente para que esta comparación sea posible.
    expect(despues).toStrictEqual(antes);

    const estadoDespues = await projectionStatus(pool, DECISION_BOARD);
    expect(estadoDespues.lastLeaf).toBe(estadoAntes.lastLeaf);
    expect(estadoDespues.storedRunningHash).toBe(estadoAntes.storedRunningHash);
    expect(estadoDespues.foldMatches).toBe(true);
  });

  it('el retraso se detecta, y NO es lo mismo que la divergencia (señal 1 del §5.4)', async () => {
    await append(pool, {
      aggregateId: id32('proyeccion-c'),
      aggregateType: 'decision',
      expectedHead: { kind: 'new' },
      requestId: requestId('proj-c'),
      events: [
        {
          eventType: 'DecisionDrafted',
          occurredAt: iso(500),
          payload: {
            eventId: id32('ev-c-1'),
            body: {
              draft: {
                proposalId: id32('propuesta-c'),
                proposalVersionHash: '33'.repeat(32),
                summary: 'Convocar la asamblea extraordinaria de octubre',
              },
            },
          },
        },
      ],
    });

    const atrasada = await projectionStatus(pool, DECISION_BOARD);
    expect(atrasada.lag).toBeGreaterThan(0n);
    expect(atrasada.foldMatches).toBe(true); // atrasada, sí; divergente, no

    await catchUp(pool, decisionBoardHandler);
    const alDia = await projectionStatus(pool, DECISION_BOARD);
    expect(alDia.lag).toBe(0n);
    expect(alDia.foldMatches).toBe(true);
    expect(await dumpDecisionBoard(pool)).toHaveLength(3);
  });

  it('la divergencia de plegado se distingue del retraso (señal 2 del §5.4)', async () => {
    // Se falsea el `running_hash` como si la proyección se hubiera construido sobre una historia
    // distinta de la que el ledger tiene hoy. `last_leaf` por sí solo NO distinguiría este caso de
    // «voy atrasado»; el plegado sí, y esa diferencia es la que separa un aviso de una alarma.
    await pool.query(
      `UPDATE projection.offset_tracker SET running_hash = decode(repeat('ab', 32), 'hex')
        WHERE projection = $1`,
      [DECISION_BOARD],
    );
    const divergente = await projectionStatus(pool, DECISION_BOARD);
    expect(divergente.lag).toBe(0n);
    expect(divergente.foldMatches).toBe(false);
    expect(divergente.storedRunningHash).toBe('ab'.repeat(32));
    expect(divergente.recomputedRunningHash).not.toBe(divergente.storedRunningHash);

    // Y la reconstrucción lo arregla, porque las proyecciones son desechables por diseño.
    await rebuild(pool, decisionBoardHandler);
    expect((await projectionStatus(pool, DECISION_BOARD)).foldMatches).toBe(true);
  });

  it('una edición manual de la proyección la delata la reconstrucción en sombra (señal 4)', async () => {
    // «Nadie edita datos a mano. Nunca.» Un UPDATE manual es indetectable por el verificador del
    // ledger —no está en el ledger— y crea una divergencia que el próximo reproceso deshace sin
    // explicación. Lo único que lo caza es comparar contra una reconstrucción.
    await pool.query(
      `UPDATE projection.decision_board SET status = 'Ratified', ballots_cast = 999
        WHERE decision_id = $1`,
      [DECISION_ID],
    );
    const manipulada = await dumpDecisionBoard(pool);
    expect(manipulada.find((r) => r.decision_id === DECISION_ID)?.ballots_cast).toBe(999);

    // El ledger no se entera: la edición no dejó ningún rastro allí. Las tres señales baratas dan
    // verde, y aun así la vista está mintiendo.
    const estado = await projectionStatus(pool, DECISION_BOARD);
    expect(estado.foldMatches).toBe(true);
    expect(estado.ledgerContiguous).toBe(true);
    expect(estado.lag).toBe(0n);

    await rebuild(pool, decisionBoardHandler);
    const reconstruida = await dumpDecisionBoard(pool);
    expect(reconstruida).not.toStrictEqual(manipulada);
    const fila = reconstruida.find((r) => r.decision_id === DECISION_ID);
    expect(fila?.ballots_cast).toBe(5);
    expect(fila?.status).toBe('Tallied');
  });

  it('reconstruir dos veces seguidas es idempotente', async () => {
    const primera = await dumpDecisionBoard(pool);
    await rebuild(pool, decisionBoardHandler);
    expect(await dumpDecisionBoard(pool)).toStrictEqual(primera);
  });

  it('CORTAR LA COLA del log se detecta, aunque no deje ningún hueco (señal 3 del §5.4)', async () => {
    // El caso que `count(*) = max(leaf_index) + 1` NO ve: al borrar los últimos eventos las dos
    // cifras bajan a la vez y la igualdad se mantiene. Lo que lo delata es `ledger_cursor`, que es
    // monótono y transaccional, y —aquí— que la proyección ya había aplicado eventos que el ledger
    // ya no tiene: un `lag` NEGATIVO no es un retraso, es una alarma.
    const antes = await projectionStatus(pool, DECISION_BOARD);
    expect(antes.ledgerContiguous).toBe(true);
    expect(antes.lag).toBe(0n);

    const client = await ready(env).superPool.connect();
    try {
      await client.query('ALTER TABLE governance.event DISABLE TRIGGER ALL');
      await client.query(
        `DELETE FROM governance.event
          WHERE leaf_index = (SELECT max(leaf_index) FROM governance.event)`,
      );
    } finally {
      await client.query('ALTER TABLE governance.event ENABLE TRIGGER ALL').catch(() => undefined);
      await client
        .query('ALTER TABLE governance.event ENABLE ALWAYS TRIGGER trg_event_append_only')
        .catch(() => undefined);
      client.release();
    }

    const estado = await projectionStatus(pool, DECISION_BOARD);

    // El hueco clásico NO existe: la igualdad de la spec sigue dando verde.
    const crudo = await pool.query<{ total: string; max_leaf: string }>(
      `SELECT count(*)::text AS total, max(leaf_index)::text AS max_leaf FROM governance.event`,
    );
    expect(BigInt(crudo.rows[0]?.total ?? '0')).toBe(BigInt(crudo.rows[0]?.max_leaf ?? '0') + 1n);

    // Y aun así la señal 3 se dispara, porque se compara contra el cursor y no sólo contra el máximo.
    expect(estado.ledgerContiguous).toBe(false);
    // Lag negativo: la proyección sirvió un evento que el ledger ya no tiene.
    expect(estado.lag).toBe(-1n);

    // Y el verificador lo denuncia con su propio código, distinto del de los huecos interiores.
    const informe = await verifyLedger(pool);
    expect(informe.ok).toBe(false);
    expect(informe.findings.some((f) => f.code === 'gap-in-global-index')).toBe(false);
    const cola = informe.findings.find((f) => f.code === 'tail-truncated');
    expect(cola).toBeDefined();
    expect(cola?.detail).toContain('del FINAL del log');

    // No es un incidente técnico de la vista: es la señal que todo este diseño existe para dar, y
    // la interfaz entra en estado de alarma pública.
  });
});
