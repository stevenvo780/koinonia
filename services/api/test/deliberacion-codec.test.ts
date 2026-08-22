/**
 * El codec de la deliberación: **el decodificador valida**.
 *
 * Un payload que no encaje se rechaza, no se acomoda. Aquí eso importa más que en los otros
 * agregados por una razón concreta: el aporte lleva su autor dentro (`authorId`) y el sobre lo lleva
 * otra vez (`actor`). Los dos entran en la preimagen del hash, así que un decodificador permisivo
 * —uno que dejara pasar un `authorId` de más, o que aceptara un cuerpo con una clave desconocida—
 * produciría un evento que se pliega distinto del que se escribió.
 *
 * Y una ida y vuelta que no conserva **exactamente** lo escrito no es un codec: es una pérdida
 * silenciosa que aparece en la siguiente verificación, con el evento ya encadenado.
 */

import type { CanonicalEvent, JsonObject } from '@koinonia/crypto';
import {
  appendChained,
  type ContributionBody,
  contributionId,
  type DeliberationEvent,
  type DeliberationPayload,
  eventId,
  instant,
  memberId,
  presentationSeed,
  circleId,
} from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import type { StoredEvent } from '../src/ledger/types.js';
import { decodeDeliberationEvent, encodeDeliberationEvent } from '../src/workspace/codec.js';

const DELIBERACION = '1'.repeat(32);
const AUTOR = '2'.repeat(32);
const EVENTO = '3'.repeat(32);
const APORTE = '4'.repeat(32);
const OTRO_APORTE = '5'.repeat(32);
const PROBLEMA = '6'.repeat(32);
const CIRCULO = '7'.repeat(32);
const SEMILLA = '8'.repeat(32);

const TEXTO = 'Los de la nocturna llegamos y la sala ya cerró: no tenemos dónde leer.';

function stored(type: string, body: JsonObject, sobre: Partial<CanonicalEvent> = {}): StoredEvent {
  const payload: JsonObject = { eventId: EVENTO, body };
  const event: CanonicalEvent = {
    aggregateId: DELIBERACION,
    aggregateType: 'deliberation',
    seq: 2,
    eventType: type,
    eventVersion: 1,
    occurredAt: '2026-08-21T15:00:00.000Z',
    actor: AUTOR,
    payload,
    ...sobre,
  };
  return {
    leafIndex: 1n,
    event,
    payloadText: JSON.stringify(payload),
    prevHash: new Uint8Array(32),
    eventHash: new Uint8Array(32),
    spineHash: undefined,
    requestId: '00000000-0000-4000-8000-000000000001',
  };
}

async function evento(payload: DeliberationPayload): Promise<DeliberationEvent> {
  return appendChained<DeliberationPayload>([], {
    eventId: eventId(EVENTO),
    aggregateId: DELIBERACION,
    occurredAt: instant(Date.UTC(2026, 7, 21, 15, 0, 0)),
    actor: memberId(AUTOR),
    payload,
  });
}

function aporte(body: ContributionBody): DeliberationPayload {
  return {
    type: 'ContributionSubmitted',
    contributionId: contributionId(APORTE),
    stage: 'perspectivas',
    body,
    authorId: memberId(AUTOR),
  };
}

const CUERPOS: readonly ContributionBody[] = [
  { kind: 'posicion', mode: 'afirmacion', text: TEXTO },
  {
    kind: 'razon',
    relation: 'sostiene',
    positionId: contributionId(OTRO_APORTE),
    text: TEXTO,
  },
  { kind: 'evidencia', supportsReasonId: contributionId(OTRO_APORTE), text: TEXTO },
  {
    kind: 'evidencia',
    supportsReasonId: contributionId(OTRO_APORTE),
    text: TEXTO,
    source: 'Horario publicado en la puerta',
  },
  {
    kind: 'supuesto',
    appliesToContributionIds: [contributionId(OTRO_APORTE)],
    text: TEXTO,
  },
  {
    kind: 'riesgo',
    alternativeId: contributionId(OTRO_APORTE),
    severity: 4,
    impact: TEXTO,
    mitigation: TEXTO,
  },
  {
    kind: 'alternativa',
    problemId: PROBLEMA,
    sourcePositionIds: [contributionId(OTRO_APORTE)],
    text: TEXTO,
  },
];

describe('codec de la deliberación: ida y vuelta exacta', () => {
  it.each(CUERPOS.map((cuerpo) => [cuerpo.kind, cuerpo] as const))(
    'conserva un aporte de tipo %s con su arista y su autor',
    async (_kind, cuerpo) => {
      const original = await evento(aporte(cuerpo));
      const escrito = encodeDeliberationEvent(original);
      const releido = decodeDeliberationEvent(
        stored(escrito.eventType, escrito.payload['body'] as JsonObject),
      );
      expect(releido.payload).toStrictEqual(original.payload);
      expect(releido.actor).toBe(original.actor);
    },
  );

  it('conserva la apertura y el avance de etapa con sus ventanas y su semilla', async () => {
    const apertura: DeliberationPayload = {
      type: 'DeliberationOpened',
      problemId: PROBLEMA,
      circleId: circleId(CIRCULO),
      stage: 'preguntas_aclaratorias',
      opensAt: instant(1_800_000_000_000),
      closesAt: instant(1_800_003_600_000),
      presentationSeed: presentationSeed(SEMILLA),
      maxContributionsPerAuthorPerStage: 10,
    };
    const avance: DeliberationPayload = {
      type: 'StageAdvanced',
      from: 'preguntas_aclaratorias',
      to: 'perspectivas',
      cause: 'manual',
      opensAt: instant(1_800_003_600_000),
      closesAt: instant(1_800_007_200_000),
      presentationSeed: presentationSeed(SEMILLA),
    };
    for (const payload of [apertura, avance]) {
      const escrito = encodeDeliberationEvent(await evento(payload));
      const releido = decodeDeliberationEvent(
        stored(escrito.eventType, escrito.payload['body'] as JsonObject),
      );
      expect(releido.payload).toStrictEqual(payload);
    }
  });

  it('conserva la corrección de un aporte por otro', async () => {
    const payload: DeliberationPayload = {
      ...aporte({ kind: 'posicion', mode: 'afirmacion', text: TEXTO }),
      supersedesContributionId: contributionId(OTRO_APORTE),
    } as DeliberationPayload;
    const escrito = encodeDeliberationEvent(await evento(payload));
    const releido = decodeDeliberationEvent(
      stored(escrito.eventType, escrito.payload['body'] as JsonObject),
    );
    expect(releido.payload).toStrictEqual(payload);
  });

  it('omite la clave opcional en vez de escribirla nula: `{}` y `{"source":null}` no hashean igual', async () => {
    const escrito = encodeDeliberationEvent(
      await evento(
        aporte({ kind: 'evidencia', supportsReasonId: contributionId(OTRO_APORTE), text: TEXTO }),
      ),
    );
    const cuerpo = (escrito.payload['body'] as JsonObject)['body'] as JsonObject;
    expect(Object.keys(cuerpo)).not.toContain('source');
    expect(Object.keys(escrito.payload['body'] as JsonObject)).not.toContain(
      'supersedesContributionId',
    );
  });
});

describe('codec de la deliberación: lo hostil se rechaza, no se acomoda', () => {
  const cuerpoValido = {
    contributionId: APORTE,
    stage: 'perspectivas',
    body: { kind: 'posicion', mode: 'afirmacion', text: TEXTO },
    authorId: AUTOR,
  };

  it('rechaza una clave desconocida en el cuerpo del evento', () => {
    expect(() =>
      decodeDeliberationEvent(
        stored('ContributionSubmitted', { ...cuerpoValido, authorPseudonym: AUTOR }),
      ),
    ).toThrow(/authorPseudonym/u);
  });

  it('rechaza una clave desconocida DENTRO del aporte, que es donde el proyector no miraría', () => {
    expect(() =>
      decodeDeliberationEvent(
        stored('ContributionSubmitted', {
          ...cuerpoValido,
          body: {
            kind: 'posicion',
            mode: 'afirmacion',
            text: TEXTO,
            authorCommitment: 'a'.repeat(64),
          },
        }),
      ),
    ).toThrow(/authorCommitment/u);
  });

  it('rechaza una etapa, un modo, una relación o una gravedad fuera del vocabulario cerrado', () => {
    expect(() =>
      decodeDeliberationEvent(
        stored('ContributionSubmitted', { ...cuerpoValido, stage: 'perspectivas_revelando' }),
      ),
    ).toThrow(/perspectivas_revelando/u);
    expect(() =>
      decodeDeliberationEvent(
        stored('ContributionSubmitted', {
          ...cuerpoValido,
          body: { kind: 'posicion', mode: 'grito', text: TEXTO },
        }),
      ),
    ).toThrow(/grito/u);
    expect(() =>
      decodeDeliberationEvent(
        stored('ContributionSubmitted', {
          ...cuerpoValido,
          body: {
            kind: 'riesgo',
            alternativeId: OTRO_APORTE,
            severity: 9,
            impact: TEXTO,
            mitigation: TEXTO,
          },
        }),
      ),
    ).toThrow(/9/u);
  });

  it('rechaza abrir una deliberación en una etapa que no sea la primera', () => {
    expect(() =>
      decodeDeliberationEvent(
        stored('DeliberationOpened', {
          problemId: PROBLEMA,
          circleId: CIRCULO,
          stage: 'objeciones',
          opensAt: 1_800_000_000_000,
          closesAt: 1_800_003_600_000,
          presentationSeed: SEMILLA,
          maxContributionsPerAuthorPerStage: 10,
        }),
      ),
    ).toThrow(/preguntas_aclaratorias/u);
  });

  it('rechaza un evento que no es de esta clase de agregado', () => {
    expect(() =>
      decodeDeliberationEvent(
        stored('ContributionSubmitted', cuerpoValido, { aggregateType: 'problem' }),
      ),
    ).toThrow(/deliberation/u);
    expect(() => decodeDeliberationEvent(stored('ContributionAuthorRevealed', {}))).toThrow(
      /no es un evento de deliberación/u,
    );
  });

  it('rechaza un identificador que no tiene la forma de un identificador', () => {
    expect(() =>
      decodeDeliberationEvent(
        stored('ContributionSubmitted', { ...cuerpoValido, contributionId: 'APORTE-1' }),
      ),
    ).toThrow();
    expect(() =>
      decodeDeliberationEvent(
        stored('ContributionSubmitted', { ...cuerpoValido, authorId: 'la persona de la nocturna' }),
      ),
    ).toThrow();
  });

  it('rechaza un aporte sin autor: el replay se quedaría sin nada que reautorizar', () => {
    const sinAutor: Record<string, unknown> = { ...cuerpoValido };
    delete sinAutor['authorId'];
    expect(() =>
      decodeDeliberationEvent(stored('ContributionSubmitted', sinAutor as JsonObject)),
    ).toThrow(/authorId/u);
  });
});
