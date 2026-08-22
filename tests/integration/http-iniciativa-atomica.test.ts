/** ADR-0043: resultado aprobado e iniciativa nacen en el mismo commit y no se duplican. */

import { createHash } from 'node:crypto';

import {
  loadDecisionState,
  loadProposalLog,
  loadProposalState,
  persistDecisionLogWithin,
  persistInitiativeLogWithin,
  persistProposalLogWithin,
  readStream,
  withTransaction,
} from '@koinonia/api';
import {
  createInitiative,
  buildDecisionConfig,
  DEFAULT_CHALLENGE_WINDOW_MS,
  draftDecision,
  decisionId as toDecisionId,
  eventId,
  freezeElectorate,
  hash,
  initiativeId as toInitiativeId,
  instant,
  linkDecision,
  memberId as toMemberId,
  openDecision,
} from '@koinonia/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  apiEnv,
  type ApiListo,
  como,
  entrar,
  FACILITADORA,
  GARANTIAS,
  listo,
  planDe,
  skipNote,
} from './helpers/api-env.js';

const env = await apiEnv();
const CIRCLE = 'e5bac105b1e00000000000000000000b';
const HOUR = 3_600_000;
let counter = 0;

function requestId(): string {
  const hex = (++counter + 0x9000).toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

function derivedRequestId(value: string): string {
  const hex = createHash('sha256').update(value, 'utf8').digest('hex');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

afterAll(async () => {
  if (env.ok) await env.stop();
});

describe.skipIf(!env.ok)(`iniciativa atomica por HTTP${skipNote(env)}`, () => {
  let e: ApiListo;
  let author: { testigo: string; miembroId: string };
  let facilitator: { testigo: string; miembroId: string };
  let decisionId = '';
  let proposalId = '';
  let initiativeId = '';
  let firstCloseRequest = '';
  let firstOpenRequest = '';
  let firstRatifyRequest = '';

  beforeAll(async () => {
    e = listo(env);
    author = await entrar(e, 'autora.iniciativa@udea.edu.co');
    facilitator = await entrar(e, FACILITADORA);

    const problem = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(author.testigo),
      payload: {
        requestId: requestId(),
        titulo: 'No hay una franja estable para estudiar de noche',
        cuerpo:
          'Quienes estudian en la jornada nocturna no disponen de una sala abierta durante una franja estable y verificable.',
        circuloId: CIRCLE,
      },
    });
    expect(problem.statusCode).toBe(201);
    const problemId = problem.json<{ id: string }>().id;

    const proposal = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(author.testigo),
      payload: {
        requestId: requestId(),
        problemaId: problemId,
        titulo: 'Abrir una franja nocturna estable de estudio',
        cuerpo:
          'Solicitar y acompañar un piloto institucional de sala nocturna durante ocho semanas, con registro semanal de apertura y uso.',
        plan: planDe(author.miembroId),
      },
    });
    expect(proposal.statusCode).toBe(201);
    proposalId = proposal.json<{ id: string }>().id;

    firstOpenRequest = requestId();
    const opened = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(facilitator.testigo),
      payload: {
        requestId: firstOpenRequest,
        propuestaId: proposalId,
        metodo: 'simple-majority',
        duracionHoras: 96,
      },
    });
    expect(opened.statusCode).toBe(201);
    const decision = opened.json<{ id: string; huellaVersion: string; plan: unknown }>();
    decisionId = decision.id;
    expect(decision.plan).toBeDefined();

    for (const voter of [author, facilitator]) {
      const ballot = await e.app.inject({
        method: 'POST',
        url: `/decisiones/${decisionId}/papeletas`,
        headers: como(voter.testigo),
        payload: {
          requestId: requestId(),
          huellaVersion: decision.huellaVersion,
          respuesta: { tipo: 'binary', aprueba: true },
        },
      });
      expect(ballot.statusCode).toBe(201);
    }

    e.reloj.avanzar(96 * HOUR + 1_000);
    facilitator = await entrar(e, FACILITADORA);
  });

  it('reintentar la apertura recupera la decision y la respuesta original', async () => {
    const decisionBefore = await readStream(e.pool, decisionId);
    const proposalBefore = await readStream(e.pool, proposalId);
    const replayed = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(facilitator.testigo),
      payload: {
        requestId: firstOpenRequest,
        propuestaId: proposalId,
        metodo: 'simple-majority',
        duracionHoras: 96,
      },
    });
    expect(replayed.statusCode).toBe(201);
    expect(replayed.json<{ id: string; seManifestaron: number }>()).toMatchObject({
      id: decisionId,
      seManifestaron: 0,
    });
    expect(await readStream(e.pool, decisionId)).toEqual(decisionBefore);
    expect(await readStream(e.pool, proposalId)).toEqual(proposalBefore);
    expect(proposalBefore.filter((row) => row.event.eventType === 'DecisionLinked')).toHaveLength(
      1,
    );
    const seedCount = await e.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM identity.decision_seed WHERE decision_id = $1',
      [decisionId],
    );
    expect(seedCount.rows[0]?.count).toBe('1');
  });

  it('si una enmienda ocupa la clave de DecisionLinked, la apertura revierte por completo', async () => {
    author = await entrar(e, 'autora.iniciativa@udea.edu.co');
    const raw = requestId();
    const occupiedLinkRequest = derivedRequestId(`${raw}|enlace-de-decision`);
    const occupying = await e.app.inject({
      method: 'POST',
      url: `/propuestas/${proposalId}/enmiendas`,
      headers: como(author.testigo),
      payload: {
        requestId: occupiedLinkRequest,
        titulo: 'Abrir una franja nocturna estable y documentada de estudio',
        cuerpo:
          'Solicitar y acompañar un piloto institucional de sala nocturna durante ocho semanas, con registro semanal de apertura, uso y bloqueos reportados.',
        motivo:
          'La propuesta necesita precisar que el registro incluya bloqueos para que la evaluación no oculte dificultades de ejecución.',
        plan: {
          ...planDe(author.miembroId),
          objetivo:
            'Conseguir una franja nocturna estable, documentada y segura para el estudio colectivo.',
        },
      },
    });
    expect(occupying.statusCode).toBe(201);

    const beforeDecisions = await e.pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT aggregate_id)::text AS count
         FROM governance.event WHERE aggregate_type = 'decision'`,
    );
    const beforeSeeds = await e.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM identity.decision_seed',
    );
    const beforeProposal = await readStream(e.pool, proposalId);

    const failed = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(facilitator.testigo),
      payload: {
        requestId: raw,
        propuestaId: proposalId,
        metodo: 'simple-majority',
        duracionHoras: 96,
      },
    });
    expect(failed.statusCode).toBe(409);
    expect(failed.json<{ codigo: string }>().codigo).toBe('IDEMPOTENCY_KEY_REUSED');

    const afterDecisions = await e.pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT aggregate_id)::text AS count
         FROM governance.event WHERE aggregate_type = 'decision'`,
    );
    const afterSeeds = await e.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM identity.decision_seed',
    );
    const rawMapping = await e.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM governance.append_request WHERE request_id = $1',
      [raw],
    );
    expect(afterDecisions.rows[0]?.count).toBe(beforeDecisions.rows[0]?.count);
    expect(afterSeeds.rows[0]?.count).toBe(beforeSeeds.rows[0]?.count);
    expect(rawMapping.rows[0]?.count).toBe('0');
    expect(await readStream(e.pool, proposalId)).toEqual(beforeProposal);
    expect(beforeProposal.filter((row) => row.event.eventType === 'DecisionLinked')).toHaveLength(
      1,
    );
  });

  it('approved crea exactamente una iniciativa enlazada y verificable', async () => {
    firstCloseRequest = requestId();
    const [closed, concurrent] = await Promise.all([
      e.app.inject({
        method: 'POST',
        url: `/decisiones/${decisionId}/cerrar`,
        headers: como(facilitator.testigo),
        payload: { requestId: firstCloseRequest },
      }),
      e.app.inject({
        method: 'POST',
        url: `/decisiones/${decisionId}/cerrar`,
        headers: como(facilitator.testigo),
        payload: { requestId: requestId() },
      }),
    ]);
    expect(closed.statusCode).toBe(200);
    expect(concurrent.statusCode).toBe(200);
    const result = closed.json<{ desenlace: string; iniciativaId: string; comprobante: string }>();
    expect(result.desenlace).toBe('approved');
    initiativeId = result.iniciativaId;
    expect(concurrent.json<{ iniciativaId: string }>().iniciativaId).toBe(initiativeId);
    expect(initiativeId).toMatch(/^[0-9a-f]{32}$/u);

    const initiatives = await e.app.inject({ method: 'GET', url: '/iniciativas' });
    expect(initiatives.statusCode).toBe(200);
    const list = initiatives.json<
      {
        id: string;
        decisionId: string;
        comprobanteDecision: string;
        estado: string;
        activa: boolean;
        ratificableEn?: number;
      }[]
    >();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: initiativeId,
      decisionId,
      comprobanteDecision: result.comprobante,
      estado: 'por-empezar',
      activa: false,
    });
    const decisionClient = await e.pool.connect();
    try {
      const state = await loadDecisionState(decisionClient, decisionId);
      if (
        state.closedAt === undefined ||
        state.resultComputedAt === undefined ||
        state.config === undefined
      ) {
        throw new Error('la prueba exige cierre y resultado publicados');
      }
      expect(list[0]?.ratificableEn).toBe(
        Math.max(state.closedAt, state.resultComputedAt) + state.config.window.challengeWindow,
      );
    } finally {
      decisionClient.release();
    }
    expect(await readStream(e.pool, initiativeId)).toHaveLength(1);
  });

  it('repetir el cierre con la misma y otra clave no añade eventos', async () => {
    const beforeDecision = await readStream(e.pool, decisionId);
    const beforeInitiative = await readStream(e.pool, initiativeId);

    for (const id of [firstCloseRequest, requestId()]) {
      const repeated = await e.app.inject({
        method: 'POST',
        url: `/decisiones/${decisionId}/cerrar`,
        headers: como(facilitator.testigo),
        payload: { requestId: id },
      });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json<{ iniciativaId: string }>().iniciativaId).toBe(initiativeId);
    }

    expect(await readStream(e.pool, decisionId)).toHaveLength(beforeDecision.length);
    expect(await readStream(e.pool, initiativeId)).toHaveLength(beforeInitiative.length);
  });

  it('ratifica y activa atómicamente; el replay exige las dos mitades y el mismo actor', async () => {
    const tooSoon = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/ratificar`,
      headers: como(facilitator.testigo),
      payload: { requestId: requestId() },
    });
    expect(tooSoon.statusCode).toBe(422);
    expect(tooSoon.json<{ codigo: string }>().codigo).toBe('CHALLENGE_WINDOW_OPEN');

    e.reloj.avanzar(DEFAULT_CHALLENGE_WINDOW_MS + 1);
    facilitator = await entrar(e, FACILITADORA);
    firstRatifyRequest = requestId();
    const beforeDecision = await readStream(e.pool, decisionId);
    const beforeInitiative = await readStream(e.pool, initiativeId);
    const ratificationNow = e.reloj.now();
    const withdrawnBetweenOldReads = ratificationNow + 1;
    await e.superPool.query(
      `UPDATE identity.member
          SET withdrawn_at = to_timestamp($2::double precision / 1000)
        WHERE member_id = $1`,
      [facilitator.miembroId, withdrawnBetweenOldReads],
    );

    // El borde HTTP lee el reloj para sesión y rate-limit antes del servicio. Las tres primeras
    // lecturas ven a la facilitadora vigente; una cuarta caería exactamente en su retirada. La
    // regresión demuestra que ratificar captura una sola vez dentro del servicio y fecha con ese
    // mismo corte tanto DecisionRatified como InitiativeActivated.
    const controlledClock = e.reloj as { now: () => number };
    const originalNow = controlledClock.now.bind(e.reloj);
    let clockReads = 0;
    controlledClock.now = () => {
      clockReads += 1;
      return clockReads <= 3 ? ratificationNow : withdrawnBetweenOldReads;
    };
    const ratified = await (async () => {
      try {
        return await e.app.inject({
          method: 'POST',
          url: `/decisiones/${decisionId}/ratificar`,
          headers: como(facilitator.testigo),
          payload: { requestId: firstRatifyRequest },
        });
      } finally {
        controlledClock.now = originalNow;
        await e.superPool.query(
          `UPDATE identity.member SET withdrawn_at = NULL WHERE member_id = $1`,
          [facilitator.miembroId],
        );
      }
    })();
    expect(ratified.statusCode).toBe(200);
    expect(clockReads).toBe(3);
    expect(ratified.json<{ id: string; activa: boolean; ratificableEn?: number }>()).toMatchObject({
      id: initiativeId,
      activa: true,
    });
    expect(ratified.json<Record<string, unknown>>()).not.toHaveProperty('ratificableEn');
    expect(await readStream(e.pool, decisionId)).toHaveLength(beforeDecision.length + 1);
    expect(await readStream(e.pool, initiativeId)).toHaveLength(beforeInitiative.length + 1);

    const mappings = await e.pool.query<{ request_scope: string }>(
      `SELECT request_scope FROM governance.append_request
        WHERE request_id = $1 ORDER BY request_scope`,
      [firstRatifyRequest],
    );
    expect(mappings.rows.map((row) => row.request_scope)).toEqual([
      'internal:initiative-activation:v1',
      'public',
    ]);

    const afterDecision = await readStream(e.pool, decisionId);
    const afterInitiative = await readStream(e.pool, initiativeId);
    expect(
      Date.parse(
        afterDecision.find((row) => row.event.eventType === 'DecisionRatified')?.event.occurredAt ??
          '',
      ),
    ).toBe(ratificationNow);
    expect(
      Date.parse(
        afterInitiative.find((row) => row.event.eventType === 'InitiativeActivated')?.event
          .occurredAt ?? '',
      ),
    ).toBe(ratificationNow);
    const replay = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/ratificar`,
      headers: como(facilitator.testigo),
      payload: { requestId: firstRatifyRequest },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ activa: boolean }>().activa).toBe(true);
    expect(await readStream(e.pool, decisionId)).toEqual(afterDecision);
    expect(await readStream(e.pool, initiativeId)).toEqual(afterInitiative);

    const guarantees = await entrar(e, GARANTIAS);
    const otherActor = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/ratificar`,
      headers: como(guarantees.testigo),
      payload: { requestId: firstRatifyRequest },
    });
    expect(otherActor.statusCode).toBe(409);
    expect(otherActor.json<{ codigo: string }>().codigo).toBe('IDEMPOTENCY_KEY_REUSED');

    // Una clave nueva no escribe otra ratificación: primero vuelve a probar el vínculo ya sellado.
    const semanticReplay = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${decisionId}/ratificar`,
      headers: como(facilitator.testigo),
      payload: { requestId: requestId() },
    });
    expect(semanticReplay.statusCode).toBe(200);
    expect(await readStream(e.pool, decisionId)).toEqual(afterDecision);
    expect(await readStream(e.pool, initiativeId)).toEqual(afterInitiative);
  });

  it('un replay no disimula la pérdida del registro interno de activación', async () => {
    const selected = await e.superPool.query<{
      request_scope: string;
      request_id: string;
      aggregate_id: string;
      first_leaf_index: string;
      event_count: number;
      head_seq: number;
      head_hash: Uint8Array;
    }>(
      `SELECT request_scope, request_id, aggregate_id,
              first_leaf_index::text AS first_leaf_index, event_count, head_seq, head_hash
         FROM governance.append_request
        WHERE request_scope = 'internal:initiative-activation:v1' AND request_id = $1`,
      [firstRatifyRequest],
    );
    const row = selected.rows[0];
    if (row === undefined) throw new Error('la prueba exige el mapping interno de activación');
    await e.superPool.query(
      'ALTER TABLE governance.append_request DISABLE TRIGGER trg_append_request_append_only',
    );
    try {
      await e.superPool.query(
        `DELETE FROM governance.append_request
          WHERE request_scope = 'internal:initiative-activation:v1' AND request_id = $1`,
        [firstRatifyRequest],
      );
      const replay = await e.app.inject({
        method: 'POST',
        url: `/decisiones/${decisionId}/ratificar`,
        headers: como(facilitator.testigo),
        payload: { requestId: firstRatifyRequest },
      });
      expect(replay.statusCode).toBe(500);
      expect(replay.json<{ codigo: string }>().codigo).toBe('INTEGRITY_RATIFICATION_ATOMICITY');
    } finally {
      try {
        await e.superPool.query(
          `INSERT INTO governance.append_request
             (request_scope, request_id, aggregate_id, first_leaf_index,
              event_count, head_seq, head_hash)
           VALUES ($1, $2, $3, $4::bigint, $5, $6, $7)`,
          [
            row.request_scope,
            row.request_id,
            row.aggregate_id,
            row.first_leaf_index,
            row.event_count,
            row.head_seq,
            row.head_hash,
          ],
        );
      } finally {
        await e.superPool.query(
          'ALTER TABLE governance.append_request ENABLE ALWAYS TRIGGER trg_append_request_append_only',
        );
      }
    }
  });

  it('una papeleta que ocupa la clave derivada del cierre no cierra ni crea iniciativa', async () => {
    author = await entrar(e, 'autora.cierre.idempotencia@udea.edu.co');
    const occupant = await entrar(e, 'ocupante.cierre.idempotencia@udea.edu.co');
    facilitator = await entrar(e, FACILITADORA);
    const problem = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(author.testigo),
      payload: {
        requestId: requestId(),
        titulo: 'El cierre debe resistir una clave derivada ya usada por otra orden',
        cuerpo:
          'La misma decisión sirve para demostrar que una papeleta previa nunca puede convertirse silenciosamente en el cierre ni crear una iniciativa.',
        circuloId: CIRCLE,
      },
    });
    expect(problem.statusCode).toBe(201);
    const proposal = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(author.testigo),
      payload: {
        requestId: requestId(),
        problemaId: problem.json<{ id: string }>().id,
        titulo: 'Cerrar sólo cuando el lote sellado sea realmente el de cierre',
        cuerpo:
          'Exigir que el registro de una decisión no confunda una papeleta previa con los eventos de cierre, resultado e iniciativa aprobada.',
        plan: planDe(author.miembroId),
      },
    });
    expect(proposal.statusCode).toBe(201);
    const opened = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(facilitator.testigo),
      payload: {
        requestId: requestId(),
        propuestaId: proposal.json<{ id: string }>().id,
        metodo: 'simple-majority',
        duracionHoras: 96,
      },
    });
    expect(opened.statusCode).toBe(201);
    const colliding = opened.json<{ id: string; huellaVersion: string }>();
    const rawClose = requestId();
    const occupiedCloseRequest = derivedRequestId(`${rawClose}|${colliding.id}|decision-close-v1`);

    for (const voter of [author, facilitator]) {
      const ballot = await e.app.inject({
        method: 'POST',
        url: `/decisiones/${colliding.id}/papeletas`,
        headers: como(voter.testigo),
        payload: {
          requestId: requestId(),
          huellaVersion: colliding.huellaVersion,
          respuesta: { tipo: 'binary', aprueba: true },
        },
      });
      expect(ballot.statusCode).toBe(201);
    }
    const occupyingBallot = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${colliding.id}/papeletas`,
      headers: como(occupant.testigo),
      payload: {
        requestId: occupiedCloseRequest,
        huellaVersion: colliding.huellaVersion,
        respuesta: { tipo: 'binary', aprueba: true },
      },
    });
    expect(occupyingBallot.statusCode).toBe(201);

    e.reloj.avanzar(96 * HOUR + 1_000);
    facilitator = await entrar(e, FACILITADORA);
    const beforeDecision = await readStream(e.pool, colliding.id);
    const beforeInitiatives = await e.pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT aggregate_id)::text AS count
         FROM governance.event WHERE aggregate_type = 'initiative'`,
    );
    const close = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${colliding.id}/cerrar`,
      headers: como(facilitator.testigo),
      payload: { requestId: rawClose },
    });
    expect(close.statusCode).toBe(409);
    expect(close.json<{ codigo: string }>().codigo).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await readStream(e.pool, colliding.id)).toEqual(beforeDecision);
    const afterInitiatives = await e.pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT aggregate_id)::text AS count
         FROM governance.event WHERE aggregate_type = 'initiative'`,
    );
    expect(afterInitiatives.rows[0]?.count).toBe(beforeInitiatives.rows[0]?.count);
  });

  it('reusar el UUID en otra decisión no cruza replays y un rechazo no crea iniciativa', async () => {
    author = await entrar(e, 'autora.iniciativa@udea.edu.co');
    const problem = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(author.testigo),
      payload: {
        requestId: requestId(),
        titulo: 'La segunda necesidad exige una decisión independiente',
        cuerpo:
          'Este segundo asunto permite comprobar que una clave repetida por el cliente no mezcla dos cierres de decisiones diferentes.',
        circuloId: CIRCLE,
      },
    });
    expect(problem.statusCode).toBe(201);
    const proposal = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(author.testigo),
      payload: {
        requestId: requestId(),
        problemaId: problem.json<{ id: string }>().id,
        titulo: 'Descartar explícitamente un segundo piloto nocturno',
        cuerpo:
          'Evaluar un segundo piloto incompatible con el primero para demostrar que el rechazo queda cerrado sin producir trabajo inexistente.',
        plan: planDe(author.miembroId),
      },
    });
    expect(proposal.statusCode).toBe(201);
    const opened = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(facilitator.testigo),
      payload: {
        requestId: requestId(),
        propuestaId: proposal.json<{ id: string }>().id,
        metodo: 'simple-majority',
        duracionHoras: 96,
      },
    });
    expect(opened.statusCode).toBe(201);
    const second = opened.json<{ id: string; huellaVersion: string }>();

    for (const voter of [author, facilitator]) {
      const ballot = await e.app.inject({
        method: 'POST',
        url: `/decisiones/${second.id}/papeletas`,
        headers: como(voter.testigo),
        payload: {
          requestId: requestId(),
          huellaVersion: second.huellaVersion,
          respuesta: { tipo: 'binary', aprueba: false },
        },
      });
      expect(ballot.statusCode).toBe(201);
    }

    e.reloj.avanzar(96 * HOUR + 1_000);
    facilitator = await entrar(e, FACILITADORA);
    const closed = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${second.id}/cerrar`,
      headers: como(facilitator.testigo),
      // Es la misma clave externa usada para cerrar la primera decisión.
      payload: { requestId: firstCloseRequest },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json<{ desenlace: string; iniciativaId?: string }>()).toMatchObject({
      desenlace: 'rejected',
    });
    expect(closed.json<Record<string, unknown>>()).not.toHaveProperty('iniciativaId');
    expect((await readStream(e.pool, second.id)).at(-1)?.event.eventType).toBe('ResultComputed');

    const initiatives = await e.app.inject({ method: 'GET', url: '/iniciativas' });
    expect(initiatives.json<unknown[]>()).toHaveLength(1);
  });

  it('la verificacion global incluye y aprueba la cardinalidad de ejecucion', async () => {
    const response = await e.app.inject({ method: 'GET', url: '/integridad' });
    expect(response.statusCode).toBe(200);
    const report = response.json<{
      todoBien: boolean;
      comprobaciones: { id: string; bien: boolean }[];
    }>();
    expect(report.todoBien).toBe(true);
    expect(report.comprobaciones.find((check) => check.id === 'ejecucion')).toEqual(
      expect.objectContaining({ bien: true }),
    );
  });

  it('la auditoría detecta si la activación deja de apuntar a la ratificación exacta', async () => {
    const selected = await e.superPool.query<{ payload: string }>(
      `SELECT payload FROM governance.event
        WHERE aggregate_id = $1 AND event_type = 'InitiativeActivated'`,
      [initiativeId],
    );
    const original = selected.rows[0]?.payload;
    if (original === undefined) throw new Error('la prueba exige InitiativeActivated');
    const envelope = JSON.parse(original) as {
      body: { ratificationEventHash: string };
      eventId: string;
    };
    envelope.body.ratificationEventHash = 'f'.repeat(64);
    const tampered = JSON.stringify(envelope);

    await e.superPool.query('ALTER TABLE governance.event DISABLE TRIGGER trg_event_append_only');
    try {
      await e.superPool.query(
        `UPDATE governance.event SET payload = $2
          WHERE aggregate_id = $1 AND event_type = 'InitiativeActivated'`,
        [initiativeId, tampered],
      );
      const response = await e.app.inject({ method: 'GET', url: '/integridad' });
      expect(response.statusCode).toBe(200);
      const report = response.json<{
        comprobaciones: { id: string; bien: boolean; detalle?: string }[];
      }>();
      const execution = report.comprobaciones.find((check) => check.id === 'ejecucion');
      expect(execution).toEqual(expect.objectContaining({ bien: false }));
      expect(execution?.detalle).toMatch(/ratific|activaci/iu);
    } finally {
      try {
        await e.superPool.query(
          `UPDATE governance.event SET payload = $2
            WHERE aggregate_id = $1 AND event_type = 'InitiativeActivated'`,
          [initiativeId, original],
        );
      } finally {
        await e.superPool.query(
          'ALTER TABLE governance.event ENABLE ALWAYS TRIGGER trg_event_append_only',
        );
      }
    }
  });

  it('una colision en la reserva aborta tambien el cierre de la decision', async () => {
    author = await entrar(e, 'autora.iniciativa@udea.edu.co');
    const problem = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(author.testigo),
      payload: {
        requestId: requestId(),
        titulo: 'Una reserva ocupada no puede producir un cierre parcial',
        cuerpo:
          'Este escenario demuestra que una historia ajena en el identificador reservado revierte el resultado completo.',
        circuloId: CIRCLE,
      },
    });
    const proposal = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(author.testigo),
      payload: {
        requestId: requestId(),
        problemaId: problem.json<{ id: string }>().id,
        titulo: 'Cerrar sin aceptar una iniciativa preexistente',
        cuerpo:
          'Votar afirmativamente y ocupar antes la reserva permite comprobar el rollback transaccional del cierre.',
        plan: planDe(author.miembroId),
      },
    });
    const collidingProposalId = proposal.json<{ id: string }>().id;
    const opened = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(facilitator.testigo),
      payload: {
        requestId: requestId(),
        propuestaId: collidingProposalId,
        metodo: 'simple-majority',
        duracionHoras: 96,
      },
    });
    const colliding = opened.json<{ id: string; huellaVersion: string }>();
    for (const voter of [author, facilitator]) {
      const ballot = await e.app.inject({
        method: 'POST',
        url: `/decisiones/${colliding.id}/papeletas`,
        headers: como(voter.testigo),
        payload: {
          requestId: requestId(),
          huellaVersion: colliding.huellaVersion,
          respuesta: { tipo: 'binary', aprueba: true },
        },
      });
      expect(ballot.statusCode).toBe(201);
    }

    const client = await e.pool.connect();
    let state: Awaited<ReturnType<typeof loadDecisionState>>;
    let plan: NonNullable<
      Awaited<ReturnType<typeof loadProposalState>>['versions'][number]['executionPlan']
    >;
    try {
      state = await loadDecisionState(client, colliding.id);
      const proposalState = await loadProposalState(client, collidingProposalId);
      const found = proposalState.versions.find(
        (version) => version.versionHash === state.proposalVersionHash,
      )?.executionPlan;
      if (found === undefined) throw new Error('la prueba exige el plan congelado');
      plan = found;
    } finally {
      client.release();
    }
    const reserved = state.draft?.plannedInitiativeId;
    const config = state.config;
    if (reserved === undefined || config === undefined || state.proposalVersionHash === undefined) {
      throw new Error('la prueba exige una decision ADR-0043 abierta');
    }
    const foreign = await createInitiative(
      { eventId: eventId(e.azar.opaqueId()), at: instant(e.reloj.now()), actor: 'system' },
      {
        initiativeId: reserved,
        outcomeKind: 'approved',
        decisionId: toDecisionId(e.azar.opaqueId()),
        proposalId: config.proposalId,
        proposalVersionHash: state.proposalVersionHash,
        decisionResultHash: hash('a'.repeat(64)),
        circleId: config.circleId,
        executionPlan: plan,
      },
    );
    await withTransaction(e.pool, (tx) =>
      persistInitiativeLogWithin(tx, foreign, { requestId: requestId() }),
    );

    e.reloj.avanzar(96 * HOUR + 1_000);
    facilitator = await entrar(e, FACILITADORA);
    const before = await readStream(e.pool, colliding.id);
    const close = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${colliding.id}/cerrar`,
      headers: como(facilitator.testigo),
      payload: { requestId: requestId() },
    });
    expect(close.statusCode).toBe(500);
    expect(close.json<{ codigo: string }>().codigo).toBe('INTEGRITY_RESERVED_INITIATIVE_OCCUPIED');
    const after = await readStream(e.pool, colliding.id);
    expect(after).toEqual(before);
    expect(
      after.filter(
        (row) =>
          row.event.eventType === 'DecisionClosed' || row.event.eventType === 'ResultComputed',
      ),
    ).toHaveLength(0);
    expect(await readStream(e.pool, reserved)).toHaveLength(1);
  });

  it('la auditoria rechaza una iniciativa de una decision historica sin reserva', async () => {
    const client = await e.pool.connect();
    let approved: Awaited<ReturnType<typeof loadDecisionState>>;
    let plan: NonNullable<
      Awaited<ReturnType<typeof loadProposalState>>['versions'][number]['executionPlan']
    >;
    try {
      approved = await loadDecisionState(client, decisionId);
      const proposal = await loadProposalState(client, proposalId);
      const found = proposal.versions.find(
        (version) => version.versionHash === approved.proposalVersionHash,
      )?.executionPlan;
      if (found === undefined) throw new Error('la prueba exige el plan aprobado');
      plan = found;
    } finally {
      client.release();
    }
    const sourceConfig = approved.config;
    if (sourceConfig === undefined || approved.proposalVersionHash === undefined) {
      throw new Error('la prueba exige una decision aprobada');
    }

    const historicalDecisionId = toDecisionId(e.azar.opaqueId());
    const opensAt = instant(e.reloj.now());
    const historicalElectorate = await freezeElectorate({
      registry: sourceConfig.electorate.members.map((member) => ({
        memberId: member.memberId,
        enrolledAt: instant(0),
        circles: member.circles,
        strata: member.strata,
      })),
      at: opensAt,
      registryVersion: sourceConfig.electorate.registryVersion,
      criterion: sourceConfig.electorate.criterion,
    });
    const historicalConfig = await buildDecisionConfig({
      ...sourceConfig,
      decisionId: historicalDecisionId,
      electorate: historicalElectorate,
      window: {
        ...sourceConfig.window,
        opensAt,
        closesAt: instant(opensAt + 96 * HOUR),
      },
    });
    let historicalLog = await draftDecision([], {
      eventId: eventId(e.azar.opaqueId()),
      at: instant(opensAt - 1),
      actor: 'system',
      decisionId: historicalDecisionId,
      // Forma historica anterior a ADR-0043: no reserva iniciativa ni conserva hash de plan.
      draft: {
        proposalId: sourceConfig.proposalId,
        proposalVersionHash: sourceConfig.proposalVersionHash,
        summary: 'Decision historica sin reserva de iniciativa',
      },
    });
    historicalLog = await openDecision(historicalLog, {
      eventId: eventId(e.azar.opaqueId()),
      at: opensAt,
      actor: 'system',
      config: historicalConfig,
    });
    await withTransaction(e.pool, async (tx) => {
      const proposalLog = await loadProposalLog(tx, proposalId);
      const linkedProposal = await linkDecision(
        proposalLog,
        {
          eventId: eventId(e.azar.opaqueId()),
          at: opensAt,
          actor: {
            memberId: toMemberId(facilitator.miembroId),
            roles: ['facilitator'],
            circles: [sourceConfig.circleId],
          },
        },
        {
          decisionId: historicalDecisionId,
          versionHash: historicalConfig.proposalVersionHash,
        },
      );
      await persistDecisionLogWithin(tx, historicalLog, { requestId: requestId() });
      await persistProposalLogWithin(tx, linkedProposal, { requestId: requestId() });
    });

    author = await entrar(e, 'autora.iniciativa@udea.edu.co');
    facilitator = await entrar(e, FACILITADORA);
    for (const voter of [author, facilitator]) {
      const ballot = await e.app.inject({
        method: 'POST',
        url: `/decisiones/${historicalDecisionId}/papeletas`,
        headers: como(voter.testigo),
        payload: {
          requestId: requestId(),
          huellaVersion: historicalConfig.proposalVersionHash,
          respuesta: { tipo: 'binary', aprueba: true },
        },
      });
      expect(ballot.statusCode).toBe(201);
    }
    e.reloj.avanzar(96 * HOUR + 1_000);
    facilitator = await entrar(e, FACILITADORA);
    const closed = await e.app.inject({
      method: 'POST',
      url: `/decisiones/${historicalDecisionId}/cerrar`,
      headers: como(facilitator.testigo),
      payload: { requestId: requestId() },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json<{ desenlace: string }>()).toMatchObject({ desenlace: 'approved' });
    const historicalStateClient = await e.pool.connect();
    let historicalState: Awaited<ReturnType<typeof loadDecisionState>>;
    try {
      historicalState = await loadDecisionState(historicalStateClient, historicalDecisionId);
    } finally {
      historicalStateClient.release();
    }
    if (historicalState.resultHash === undefined) {
      throw new Error('la prueba exige un resultado historico aprobado');
    }

    const unreservedId = toInitiativeId(e.azar.opaqueId());
    const historicalFraud = await createInitiative(
      { eventId: eventId(e.azar.opaqueId()), at: instant(e.reloj.now()), actor: 'system' },
      {
        initiativeId: unreservedId,
        outcomeKind: 'approved',
        decisionId: historicalDecisionId,
        proposalId: historicalConfig.proposalId,
        proposalVersionHash: historicalConfig.proposalVersionHash,
        decisionResultHash: historicalState.resultHash,
        circleId: historicalConfig.circleId,
        executionPlan: plan,
      },
    );
    await withTransaction(e.pool, (tx) =>
      persistInitiativeLogWithin(tx, historicalFraud, { requestId: requestId() }),
    );

    const report = await e.app.inject({ method: 'GET', url: '/integridad' });
    expect(report.statusCode).toBe(200);
    const execution = report
      .json<{ comprobaciones: { id: string; bien: boolean; detalle?: string }[] }>()
      .comprobaciones.find((check) => check.id === 'ejecucion');
    expect(execution).toEqual(expect.objectContaining({ bien: false }));
    expect(execution?.detalle).toContain(unreservedId);
    expect(execution?.detalle).toContain('reserve exactamente su id');
  });

  it('la auditoria comprueba en ambos sentidos el enlace propuesta-decision', async () => {
    const client = await e.pool.connect();
    let source: Awaited<ReturnType<typeof loadDecisionState>>;
    try {
      source = await loadDecisionState(client, decisionId);
    } finally {
      client.release();
    }
    const sourceConfig = source.config;
    if (sourceConfig === undefined) throw new Error('la prueba exige una decision abierta valida');

    const orphanId = toDecisionId(e.azar.opaqueId());
    const danglingId = toDecisionId(e.azar.opaqueId());
    const opensAt = instant(e.reloj.now());
    const electorate = await freezeElectorate({
      registry: sourceConfig.electorate.members.map((member) => ({
        memberId: member.memberId,
        enrolledAt: instant(0),
        circles: member.circles,
        strata: member.strata,
      })),
      at: opensAt,
      registryVersion: sourceConfig.electorate.registryVersion,
      criterion: sourceConfig.electorate.criterion,
    });
    const config = await buildDecisionConfig({
      ...sourceConfig,
      decisionId: orphanId,
      electorate,
      window: {
        ...sourceConfig.window,
        opensAt,
        closesAt: instant(opensAt + 96 * HOUR),
      },
    });
    let orphanLog = await draftDecision([], {
      eventId: eventId(e.azar.opaqueId()),
      at: instant(opensAt - 1),
      actor: 'system',
      decisionId: orphanId,
      draft: {
        proposalId: config.proposalId,
        proposalVersionHash: config.proposalVersionHash,
        summary: 'Decision valida sin su enlace inverso de propuesta',
      },
    });
    orphanLog = await openDecision(orphanLog, {
      eventId: eventId(e.azar.opaqueId()),
      at: opensAt,
      actor: 'system',
      config,
    });

    await withTransaction(e.pool, async (tx) => {
      await persistDecisionLogWithin(tx, orphanLog, { requestId: requestId() });
      const proposalLog = await loadProposalLog(tx, proposalId);
      const danglingProposal = await linkDecision(
        proposalLog,
        {
          eventId: eventId(e.azar.opaqueId()),
          at: opensAt,
          actor: {
            memberId: toMemberId(facilitator.miembroId),
            roles: ['facilitator'],
            circles: [config.circleId],
          },
        },
        { decisionId: danglingId, versionHash: config.proposalVersionHash },
      );
      await persistProposalLogWithin(tx, danglingProposal, { requestId: requestId() });
    });

    const report = await e.app.inject({ method: 'GET', url: '/integridad' });
    expect(report.statusCode).toBe(200);
    const results = report
      .json<{ comprobaciones: { id: string; bien: boolean; detalle?: string }[] }>()
      .comprobaciones.find((check) => check.id === 'resultados');
    expect(results).toEqual(expect.objectContaining({ bien: false }));
    expect(results?.detalle).toContain(orphanId);
    expect(results?.detalle).toContain(danglingId);
    expect(results?.detalle).toContain('enlace');
  });
});
