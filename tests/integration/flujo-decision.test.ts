/**
 * El vertical slice: una decisión real, persistida y reconstruida (§5 de la tarea).
 *
 * La afirmación que hay que sostener, y no una parecida:
 *
 *     el log leído de la base es IDÉNTICO al original, y volver a escrutarlo produce el MISMO
 *     `resultHash`, bit a bit.
 *
 * «Equivalente» no vale. El `resultHash` es lo que la asamblea publica; si la copia leída de la base
 * produjera otro, no habría manera de decidir cuál de los dos es el bueno, y la promesa entera —«el
 * mismo escrutinio, ejecutado por cualquiera, en cualquier máquina, dentro de cinco años, produce el
 * mismo hash»— se queda en eslogan.
 */

import {
  append,
  emitCheckpoint,
  latestCheckpoint,
  loadDecisionLog,
  loadDecisionState,
  persistDecisionLog,
  readStream,
  verifyLedger,
  type PgPool,
} from '@koinonia/api';
import { SPINE_AGGREGATE_ID, toHex } from '@koinonia/crypto';
import { computeResult, replay, verifyLog } from '@koinonia/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFullDecision,
  DECISION_ID,
  type DecisionFixture,
} from './helpers/decision-fixture.js';
import { id32, iso, ledgerEnv, ready, requestId, skipNote } from './helpers/ledger-env.js';

const env = await ledgerEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

describe.skipIf(!env.ok)(`flujo completo de decisión${skipNote(env)}`, () => {
  let pool: PgPool;
  let fixture: DecisionFixture;

  beforeAll(async () => {
    pool = ready(env).appPool;
    fixture = await buildFullDecision();
  });

  it('el log del dominio se persiste entero en el ledger', async () => {
    // 1 borrador + 1 apertura + 5 papeletas + 1 cierre + 1 resultado = 9 eventos.
    expect(fixture.log).toHaveLength(9);

    const persistido = await persistDecisionLog(pool, fixture.log, {
      requestId: requestId('flujo-decision'),
    });
    expect(persistido.appended).toBe(9);
    expect(persistido.decisionId).toBe(DECISION_ID);

    const stored = await readStream(pool, DECISION_ID);
    expect(stored).toHaveLength(9);
    // El `seq` del dominio es denso desde 1 y el del ledger desde 0: el génesis del ledger DEBE ser
    // `seq = 0`, y ahí es donde cuelga de la espina.
    expect(stored.map((s) => s.event.seq)).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(stored.map((s) => s.event.eventType)).toStrictEqual([
      'DecisionDrafted',
      'DecisionOpened',
      'BallotCast',
      'BallotCast',
      'BallotCast',
      'BallotCast',
      'BallotCast',
      'DecisionClosed',
      'ResultComputed',
    ]);
    // El sistema actúa sin `actor`: la clave se OMITE, nunca se emite `null` (§1.3.d).
    expect(stored[0]?.event.actor).toBeUndefined();
    expect(stored[2]?.event.actor).toBeDefined();
  });

  it('el nacimiento de la decisión quedó anclado a la espina con doble vínculo (§2.3)', async () => {
    const stored = await readStream(pool, DECISION_ID);
    const genesis = stored[0];
    expect(genesis).toBeDefined();
    if (genesis === undefined) return;

    // Vínculo hacia atrás: el génesis NO cuelga de 32 ceros, cuelga de la cabeza de la espina.
    expect(genesis.spineHash).toBeDefined();
    expect(toHex(genesis.prevHash)).toBe(toHex(genesis.spineHash ?? new Uint8Array()));
    expect(toHex(genesis.prevHash)).not.toBe('00'.repeat(32));

    // Vínculo hacia adelante: la espina registró el nacimiento con el `genesisHash` exacto, en el
    // MISMO commit.
    const espina = await readStream(pool, SPINE_AGGREGATE_ID);
    const apertura = espina.find(
      (e) =>
        e.event.eventType === 'AgregadoAbierto' && e.event.payload['aggregateId'] === DECISION_ID,
    );
    expect(apertura).toBeDefined();
    expect(apertura?.event.payload['genesisHash']).toBe(toHex(genesis.eventHash));
    expect(apertura?.event.payload['aggregateType']).toBe('decision');
  });

  it('el log RECONSTRUIDO desde la base es idéntico al original, evento a evento', async () => {
    const recuperado = await loadDecisionLog(pool, DECISION_ID);
    expect(recuperado).toHaveLength(fixture.log.length);
    // `seq`, `prevHash` y `hash` NO se leyeron de la base: los recomputó `appendEvent` al rehidratar.
    // Que coincidan es, por tanto, una comprobación, no una copia.
    expect(recuperado).toStrictEqual(fixture.log);
    expect(recuperado.at(-1)?.hash).toBe(fixture.log.at(-1)?.hash);
  });

  it('la cadena de hashes del dominio verifica sobre lo reconstruido (INV-19)', async () => {
    const recuperado = await loadDecisionLog(pool, DECISION_ID);
    await expect(verifyLog(recuperado)).resolves.toBeDefined();
    const estado = await loadDecisionState(pool, DECISION_ID);
    expect(estado.status).toBe(replay(fixture.log).status);
    expect(estado.ballots).toHaveLength(5);
    expect(estado.closedAt).toBe(replay(fixture.log).closedAt);
  });

  it('RE-ESCRUTAR lo reconstruido produce el MISMO resultHash, bit a bit', async () => {
    const recuperado = await loadDecisionLog(pool, DECISION_ID);

    // El escrutinio original corrió sobre el log CERRADO, antes de anclar el resultado. Re-escrutar
    // ese mismo prefijo tiene que devolver el mismo objeto entero, campo a campo.
    const reescrutado = await computeResult(recuperado.slice(0, -1));
    expect(reescrutado).toStrictEqual(fixture.result);

    // Y sobre el log COMPLETO —un evento más— el `resultHash` sigue siendo el mismo, porque
    // `computedFromSeq` es procedencia y queda deliberadamente FUERA de la preimagen (A.8). Que
    // ambas cosas se cumplan a la vez es lo que hace que el hash publicado sea estable.
    const conAncla = await computeResult(recuperado);
    expect(conAncla.resultHash).toBe(fixture.result.resultHash);
    expect(conAncla.computedFromSeq).not.toBe(reescrutado.computedFromSeq);

    // Y coincide con lo que quedó anclado en el propio ledger, que es lo que se publica.
    const stored = await readStream(pool, DECISION_ID);
    const anclado = stored.at(-1)?.event.payload['body'];
    expect(anclado).toMatchObject({ resultHash: fixture.result.resultHash });
    expect(fixture.result.outcome).toStrictEqual({
      kind: 'approved',
      option: fixture.config.options[0],
    });
  });

  it('la configuración congelada sobrevive a la ida y vuelta: fracciones exactas incluidas', async () => {
    const recuperado = await loadDecisionLog(pool, DECISION_ID);
    const apertura = recuperado[1];
    expect(apertura?.payload.type).toBe('DecisionOpened');
    if (apertura?.payload.type !== 'DecisionOpened') return;

    const config = apertura.payload.config;
    // El `configHash` se recomputa dentro de `computeResult`; que coincida demuestra que ni un
    // `bigint` de las fracciones ni un miembro del padrón se perdieron por el camino.
    expect(config.configHash).toBe(fixture.config.configHash);
    expect(config.electorate.rollHash).toBe(fixture.config.electorate.rollHash);
    expect(config.electorate.members).toStrictEqual(fixture.config.electorate.members);
    expect(config.quorum.participation.num).toBe(fixture.config.quorum.participation.num);
    expect(typeof config.quorum.participation.num).toBe('bigint');
    expect(config.delegation.cap).toStrictEqual(fixture.config.delegation.cap);
  });

  it('persistir el mismo log otra vez no añade nada', async () => {
    const otra = await persistDecisionLog(pool, fixture.log, {
      requestId: requestId('flujo-decision-2'),
    });
    expect(otra.appended).toBe(0);
    expect(await readStream(pool, DECISION_ID)).toHaveLength(9);
  });

  it('el ledger completo verifica', async () => {
    const informe = await verifyLedger(pool);
    expect(informe.findings).toStrictEqual([]);
    expect(informe.ok).toBe(true);
  });

  // ── Checkpoints (§6) ────────────────────────────────────────────────────────────────────────

  it('un checkpoint se emite, se encadena y se auto-registra en la espina', async () => {
    const primero = await emitCheckpoint(pool, {
      issuedAt: '2026-08-24T03:00:00.000Z',
      requestId: requestId('checkpoint-1'),
      firm: true,
    });
    // Regla del primer checkpoint: `prevCheckpoint` se OMITE del objeto canónico, no se emite null
    // ni un centinela de 64 ceros. La spec lo dejaba indefinido y dos implementaciones honestas
    // producían dos hashes distintos para el checkpoint que ancla el origen de la vigencia.
    expect(primero.prevCheckpoint).toBeUndefined();
    expect(primero.treeSize).toBeGreaterThan(0n);

    // El `CheckpointEmitido` cae exactamente en `leaf_index = treeSize`, así que queda DENTRO del
    // siguiente checkpoint: el log se compromete recursivamente con su historia de publicaciones.
    const espina = await readStream(pool, SPINE_AGGREGATE_ID);
    const registro = espina.find((e) => e.event.eventType === 'CheckpointEmitido');
    expect(registro).toBeDefined();
    expect(registro?.leafIndex).toBe(primero.treeSize);
    expect(registro?.event.payload['checkpointHash']).toBe(toHex(primero.checkpointHash));

    await append(pool, {
      aggregateId: id32('post-checkpoint'),
      aggregateType: 'propuesta',
      expectedHead: { kind: 'new' },
      requestId: requestId('post-checkpoint'),
      events: [{ eventType: 'PropuestaAbierta', occurredAt: iso(0), payload: { n: 1 } }],
    });

    const segundo = await emitCheckpoint(pool, {
      issuedAt: '2026-08-25T03:00:00.000Z',
      requestId: requestId('checkpoint-2'),
    });
    expect(segundo.treeSize).toBeGreaterThan(primero.treeSize);
    expect(segundo.prevCheckpoint).toBeDefined();
    expect(toHex(segundo.prevCheckpoint ?? new Uint8Array())).toBe(toHex(primero.checkpointHash));
    expect(toHex(segundo.rootHash)).not.toBe(toHex(primero.rootHash));
    expect(toHex(segundo.headsRoot)).not.toBe(toHex(primero.headsRoot));

    const ultimo = await latestCheckpoint(pool);
    expect(toHex(ultimo?.checkpointHash ?? new Uint8Array())).toBe(toHex(segundo.checkpointHash));
  });

  it('un checkpoint tampoco se puede editar ni borrar', async () => {
    await expect(
      ready(env).superPool.query('DELETE FROM governance.checkpoint'),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('el ledger sigue verificando después de los checkpoints', async () => {
    const informe = await verifyLedger(pool);
    expect(informe.findings).toStrictEqual([]);
  });
});
