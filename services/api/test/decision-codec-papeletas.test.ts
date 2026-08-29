/**
 * `encodeDecisionEvent` / `decodeDecisionEvent`: el punto exacto donde una papeleta de puntuación o
 * de menciones se convierte en lo que de verdad se escribe en el historial, y vuelve.
 *
 * ═══ Lo que esto reproduce ═══
 *
 * Antes de esta revisión, tanto el dominio (`BallotPayload`, `packages/domain/src/ballot.ts`) como
 * el codec del ledger representaban estas dos papeletas con `{[opción]: nota}` — un objeto con el
 * identificador de la opción de CLAVE — y `null` para «sin opinión». Las dos cosas violan el perfil
 * canónico del ledger (`packages/crypto/src/canonical.ts`, `LEDGER_PROFILE`): las claves tienen que
 * empezar por letra (`^[A-Za-z][A-Za-z0-9_]*$`) y `null` está prohibido del todo. Un `OptionId` es
 * 32 hexadecimales al azar —cerca del 62 % empieza por dígito—, así que la mayoría de las papeletas
 * de puntuación o de menciones revientaban al escribirse, tanto al emitir la papeleta (`castBallot`
 * del dominio recalcula el hash del evento en el momento) como al persistirla: `POST
 * /decisiones/:id/papeletas` devolvía 500. Este fichero prueba el codec directamente, sin levantar
 * Postgres, con un identificador de opción que empieza por dígito a propósito — es el caso que antes
 * fallaba, no el caso raro que pasaba.
 */

import {
  canonicalizeToBytes,
  LEDGER_PROFILE,
  type CanonicalEvent,
  type JsonObject,
} from '@koinonia/crypto';
import {
  ballotId,
  decisionId,
  eventId,
  hash,
  instant,
  memberId,
  optionId,
  type Ballot,
  type DecisionEvent,
  type GradeId,
} from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import {
  decodeDecisionEvent,
  DECISION_AGGREGATE_TYPE,
  encodeDecisionEvent,
} from '../src/decision/codec.js';
import type { StoredEvent } from '../src/ledger/types.js';

const DECISION_ID = decisionId('1'.repeat(32));
const VOTER = memberId('2'.repeat(32));
// Empieza por dígito: es la mayoría de los identificadores reales, y es el caso que reventaba el
// historial cuando la opción viajaba como clave de un mapa.
const OPCION_DIGITO = optionId('0184fbe5000000000000000000000000');
const OPCION_LETRA = optionId('ab000000000000000000000000000000');
const HASH = hash('a'.repeat(64));

function ballotEvent(ballot: Ballot): DecisionEvent {
  return {
    eventId: eventId('3'.repeat(32)),
    decisionId: DECISION_ID,
    seq: ballot.seq,
    occurredAt: ballot.castAt,
    actor: ballot.voter,
    payload: { type: 'BallotCast', ballot },
    prevHash: HASH,
    hash: HASH,
  };
}

function baseBallot(): Omit<Ballot, 'payload'> {
  return {
    ballotId: ballotId('4'.repeat(32)),
    decisionId: DECISION_ID,
    voter: VOTER,
    round: 1,
    castAt: instant(Date.UTC(2026, 7, 21, 14, 0, 0)),
    seq: 1,
    proposalVersionHash: HASH,
  };
}

/** El evento tal como saldría de la base: un `StoredEvent` que envuelve el `LedgerEventDraft`. */
function stored(draft: ReturnType<typeof encodeDecisionEvent>): StoredEvent {
  const event: CanonicalEvent = {
    aggregateId: DECISION_ID,
    aggregateType: DECISION_AGGREGATE_TYPE,
    seq: 1,
    eventType: draft.eventType,
    eventVersion: draft.eventVersion ?? 1,
    occurredAt: draft.occurredAt,
    ...(draft.actor === undefined ? {} : { actor: draft.actor }),
    payload: draft.payload,
  };
  return {
    leafIndex: 1n,
    event,
    payloadText: JSON.stringify(draft.payload),
    prevHash: new Uint8Array(32),
    eventHash: new Uint8Array(32),
    spineHash: undefined,
    requestId: '00000000-0000-4000-8000-000000000001',
  };
}

describe('la papeleta de puntuación con «sin opinión» y una opción que empieza por dígito', () => {
  it('se hashea sin lanzar: ni una clave es la opción, ni un `null` aparece en ningún lado', () => {
    const ballot: Ballot = {
      ...baseBallot(),
      payload: {
        kind: 'score',
        // `OPCION_LETRA` no aparece en la lista: es «sin opinión» sobre ella, y por eso no hay par
        // que mandar. Ni acá ni en ningún otro punto de la preimagen puede aparecer un `null`.
        scores: [{ option: OPCION_DIGITO, value: 5 }],
      },
    };
    const draft = encodeDecisionEvent(ballotEvent(ballot));

    // La aserción que de verdad importa: esto NO lanza. Con el mapa de antes ({opción: nota}),
    // `OPCION_DIGITO` como clave hacía que esto reventara con `KEY_PATTERN` casi siempre.
    expect(() => canonicalizeToBytes(draft.payload, LEDGER_PROFILE)).not.toThrow();

    const cuerpo = draft.payload['body'] as JsonObject;
    const ballotJson = cuerpo['ballot'] as JsonObject;
    const payloadJson = ballotJson['payload'] as JsonObject;
    // La forma persistida es una LISTA de pares, nunca un mapa con la opción de clave.
    expect(Array.isArray(payloadJson['scores'])).toBe(true);
    expect(payloadJson['scores']).toEqual([{ option: OPCION_DIGITO, value: 5 }]);
    // Y en ningún punto de la preimagen aparece un `null`.
    expect(JSON.stringify(payloadJson)).not.toMatch(/null/u);
  });

  it('decodificada de vuelta, la opción sin nota simplemente no está en la lista (no es `null`)', () => {
    const ballot: Ballot = {
      ...baseBallot(),
      payload: {
        kind: 'score',
        // `OPCION_LETRA` queda deliberadamente ausente: es la forma de decir «sin opinión».
        scores: [{ option: OPCION_DIGITO, value: 4 }],
      },
    };
    const draft = encodeDecisionEvent(ballotEvent(ballot));
    const reconstruido = decodeDecisionEvent(stored(draft));

    if (
      reconstruido.payload.type !== 'BallotCast' ||
      reconstruido.payload.ballot.payload.kind !== 'score'
    ) {
      throw new Error('se esperaba una papeleta de puntuación');
    }
    const { scores } = reconstruido.payload.ballot.payload;
    expect(scores).toEqual([{ option: OPCION_DIGITO, value: 4 }]);
    expect(scores.some((entry) => entry.option === OPCION_LETRA)).toBe(false);
  });

  it('dos opciones puntuadas se ordenan por identificador al escribirse en el historial', () => {
    // El orden en que llega la papeleta no importa para lo que se hashea: se ordena por opción, así
    // que la misma papeleta siempre produce el mismo historial sin importar en qué orden se
    // construyó en memoria.
    const ballot: Ballot = {
      ...baseBallot(),
      payload: {
        kind: 'score',
        scores: [
          { option: OPCION_LETRA, value: 2 },
          { option: OPCION_DIGITO, value: 5 },
        ],
      },
    };
    const draft = encodeDecisionEvent(ballotEvent(ballot));
    const cuerpo = draft.payload['body'] as JsonObject;
    const ballotJson = cuerpo['ballot'] as JsonObject;
    const payloadJson = ballotJson['payload'] as JsonObject;
    expect(payloadJson['scores']).toEqual([
      { option: OPCION_DIGITO, value: 5 },
      { option: OPCION_LETRA, value: 2 },
    ]);
  });
});

describe('la papeleta de menciones con una opción que empieza por dígito', () => {
  it('se hashea sin lanzar y persiste como lista de pares {option, grade}', () => {
    const ballot: Ballot = {
      ...baseBallot(),
      payload: {
        kind: 'grades',
        grades: [{ option: OPCION_DIGITO, grade: 'excelente' as GradeId }],
      },
    };
    const draft = encodeDecisionEvent(ballotEvent(ballot));
    expect(() => canonicalizeToBytes(draft.payload, LEDGER_PROFILE)).not.toThrow();

    const cuerpo = draft.payload['body'] as JsonObject;
    const ballotJson = cuerpo['ballot'] as JsonObject;
    const payloadJson = ballotJson['payload'] as JsonObject;
    expect(payloadJson['grades']).toEqual([{ option: OPCION_DIGITO, grade: 'excelente' }]);
  });

  it('decodificada de vuelta, reconstruye la misma lista parcial de menciones', () => {
    const ballot: Ballot = {
      ...baseBallot(),
      payload: {
        kind: 'grades',
        grades: [{ option: OPCION_DIGITO, grade: 'excelente' as GradeId }],
      },
    };
    const draft = encodeDecisionEvent(ballotEvent(ballot));
    const reconstruido = decodeDecisionEvent(stored(draft));

    if (
      reconstruido.payload.type !== 'BallotCast' ||
      reconstruido.payload.ballot.payload.kind !== 'grades'
    ) {
      throw new Error('se esperaba una papeleta de menciones');
    }
    expect(reconstruido.payload.ballot.payload.grades).toEqual([
      { option: OPCION_DIGITO, grade: 'excelente' },
    ]);
  });
});
