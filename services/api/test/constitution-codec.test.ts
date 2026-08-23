/**
 * El codec de la constitución: **la ida y vuelta tiene que ser fiel, y se mide contra la huella**.
 *
 * No basta con comparar objetos. Lo que importa es que el evento rehidratado produzca **el mismo
 * eslabón** que el que se escribió: `appendChained` hashea la preimagen canónica del payload, así
 * que un campo perdido, un `2/3` que vuelve como `0.667` o una clave que se cuela cambian el hash y
 * el historial deja de verificar. Por eso cada caso de este fichero termina comparando hashes y no
 * sólo formas.
 *
 * La simulación del almacenamiento es fiel a propósito: el payload se pasa por `canonicalize` y se
 * vuelve a leer con `parseCanonical`, que es exactamente lo que hace la columna `payload` del
 * ledger —texto canónico JCS— y lo que haría una restauración desde un volcado.
 */

import {
  canonicalize,
  type CanonicalEvent,
  type JsonObject,
  parseCanonical,
} from '@koinonia/crypto';
import {
  appendChained,
  type ChainedEvent,
  type Clause,
  clauseId,
  type ConstitutionPayload,
  type ConstitutionText,
  CORE_CLAUSE_IDS,
  decisionId,
  ENTRENCHED_REFORM_V1,
  eventId,
  fraction,
  type FrozenReformRules,
  hash as toHash,
  instant,
  memberId,
  ORDINARY_REFORM_V1,
  reformId,
  type ReformVote,
} from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import {
  CONSTITUTION_AGGREGATE_TYPE,
  ConstitutionCodecError,
  decodeConstitutionEvent,
  encodeConstitutionEvent,
} from '../src/constitution/codec.js';
import type { StoredEvent } from '../src/ledger/types.js';

const CONSTITUCION = '00000000000000000000000000000003';
const ACTOR = 'a'.repeat(32);
const EVENTO = 'e'.repeat(32);
const REFORMA = 'f'.repeat(32);
const DECISION = 'd'.repeat(32);
const GARANTE = 'b'.repeat(32);

/** Seis huellas distintas y reconocibles, una por punto del núcleo. */
function huella(n: number): ReturnType<typeof toHash> {
  return toHash(String(n).repeat(64).slice(0, 64));
}

const NUCLEO: readonly Clause[] = CORE_CLAUSE_IDS.map((id, i) => ({
  clauseId: id,
  textHash: huella(i + 1),
}));

/** El texto: los seis del núcleo más una regla corriente, estrictamente ordenados por etiqueta. */
const TEXTO: ConstitutionText = {
  clauses: [...NUCLEO, { clauseId: clauseId('zona_horaria'), textHash: huella(7) }].sort((a, b) =>
    a.clauseId < b.clauseId ? -1 : 1,
  ),
  ordinary: ORDINARY_REFORM_V1,
  entrenched: ENTRENCHED_REFORM_V1,
  validityMonths: 12,
};

const CONGELADO: FrozenReformRules = {
  requirements: ORDINARY_REFORM_V1,
  censusSize: 300,
  guarantors: [1, 2, 3, 4, 5].map((n) => memberId(String(n).repeat(32))),
  calendar: {
    semesterEndsAt: instant(Date.UTC(2026, 11, 15)),
    convened: [
      {
        decisionId: decisionId(DECISION),
        opensAt: instant(Date.UTC(2026, 9, 20)),
        affectsClauseIds: [clauseId('zona_horaria')],
      },
    ],
  },
};

const VOTO: ReformVote = {
  round: 1,
  decisionId: decisionId(DECISION),
  votesInFavor: 200,
  directParticipation: 100,
  opensAt: instant(Date.UTC(2026, 8, 1)),
  closesAt: instant(Date.UTC(2026, 8, 8)),
};

const PAYLOADS: readonly ConstitutionPayload[] = [
  {
    type: 'ConstitutionFounded',
    version: 1,
    text: TEXTO,
    core: NUCLEO,
    foundingDecisionId: decisionId(DECISION),
    censusSize: 300,
    votesInFavor: 120,
    castBallots: 150,
    directParticipation: 150,
    effectiveAt: instant(Date.UTC(2026, 7, 21, 14, 0, 0, 0)),
  },
  {
    type: 'ReformOpened',
    reformId: reformId(REFORMA),
    kind: 'ordinaria',
    targetVersion: 1,
    proposedText: TEXTO,
    frozen: CONGELADO,
    sponsorCount: 30,
    deliberationOpensAt: instant(Date.UTC(2026, 7, 22)),
    deliberationClosesAt: instant(Date.UTC(2026, 8, 12)),
  },
  { type: 'ReformVoteRecorded', reformId: reformId(REFORMA), vote: VOTO },
  {
    type: 'ReformApprovedByGuarantor',
    reformId: reformId(REFORMA),
    guarantorId: memberId(GARANTE),
  },
  {
    type: 'ReformRatified',
    reformId: reformId(REFORMA),
    version: 2,
    effectiveAt: instant(Date.UTC(2026, 9, 1)),
  },
  { type: 'ReformRejected', reformId: reformId(REFORMA), reason: 'umbral_no_alcanzado' },
];

async function evento(payload: ConstitutionPayload): Promise<ChainedEvent<ConstitutionPayload>> {
  return appendChained<ConstitutionPayload>([], {
    eventId: eventId(EVENTO),
    aggregateId: CONSTITUCION,
    occurredAt: instant(Date.UTC(2026, 7, 21, 14, 3, 7, 100)),
    actor: memberId(ACTOR),
    payload,
  });
}

/**
 * Guarda y relee como lo haría el ledger: el payload viaja como **texto canónico JCS** y vuelve
 * parseado de ese texto. Si el codec produjera algo que no es canonicalizable, se ve aquí.
 */
function guardar(draft: ReturnType<typeof encodeConstitutionEvent>, seq = 0): StoredEvent {
  const texto = canonicalize(draft.payload);
  const payload = parseCanonical(texto) as JsonObject;
  const canonico: CanonicalEvent = {
    aggregateId: CONSTITUCION,
    aggregateType: CONSTITUTION_AGGREGATE_TYPE,
    seq,
    eventType: draft.eventType,
    eventVersion: draft.eventVersion ?? 1,
    occurredAt: draft.occurredAt,
    ...(draft.actor === undefined ? {} : { actor: draft.actor }),
    payload,
  };
  return {
    leafIndex: BigInt(seq),
    event: canonico,
    payloadText: texto,
    prevHash: new Uint8Array(32),
    eventHash: new Uint8Array(32),
    spineHash: undefined,
    requestId: '00000000-0000-4000-8000-0000000000aa',
  };
}

describe('codec de la constitución: la ida y vuelta conserva la huella', () => {
  it.each(PAYLOADS.map((p) => [p.type, p] as const))(
    '%s vuelve idéntico y con el mismo eslabón',
    async (_tipo, payload) => {
      const original = await evento(payload);
      const releido = decodeConstitutionEvent(guardar(encodeConstitutionEvent(original)));
      const rehidratado = await appendChained<ConstitutionPayload>([], releido);

      // (1) La forma: el payload que vuelve es el que se escribió, campo por campo.
      expect(rehidratado.payload).toStrictEqual(original.payload);
      // (2) Y lo que de verdad importa: el eslabón. Si el codec perdiera un campo o cambiara la
      //     representación de una fracción, esto es lo que se rompería, y se rompería tarde.
      expect(rehidratado.hash).toBe(original.hash);
      expect(rehidratado.actor).toBe(original.actor);
      expect(rehidratado.occurredAt).toBe(original.occurredAt);
    },
  );

  it('las proporciones vuelven como enteros exactos, nunca como decimales', async () => {
    const original = await evento(PAYLOADS[0] as ConstitutionPayload);
    const draft = encodeConstitutionEvent(original);
    const texto = canonicalize(draft.payload);

    // En el texto guardado no hay un solo decimal: `2/3` viaja como {"den":"3","num":"2"}.
    expect(texto).toContain('"num":"2"');
    expect(texto).toContain('"den":"3"');
    expect(texto).not.toMatch(/0\.6/u);

    const releido = decodeConstitutionEvent(guardar(draft));
    const payload = releido.payload;
    if (payload.type !== 'ConstitutionFounded') throw new Error('otro tipo');
    expect(payload.text.ordinary.approvalOfCensus).toStrictEqual(fraction(2n, 3n));
    expect(payload.text.entrenched.approvalOfCensus).toStrictEqual(fraction(3n, 4n));
  });

  it('el texto propuesto conserva TODAS las cláusulas y su orden', async () => {
    const original = await evento(PAYLOADS[1] as ConstitutionPayload);
    const releido = decodeConstitutionEvent(guardar(encodeConstitutionEvent(original)));
    const payload = releido.payload;
    if (payload.type !== 'ReformOpened') throw new Error('otro tipo');
    expect(payload.proposedText.clauses.map((c) => c.clauseId)).toStrictEqual(
      TEXTO.clauses.map((c) => c.clauseId),
    );
  });
});

describe('codec de la constitución: el decodificador valida en vez de acomodar', () => {
  async function almacenado(payload: ConstitutionPayload): Promise<StoredEvent> {
    return guardar(encodeConstitutionEvent(await evento(payload)));
  }

  function conCuerpo(stored: StoredEvent, cambio: (body: JsonObject) => JsonObject): StoredEvent {
    const payload = stored.event.payload;
    const body = payload['body'] as JsonObject;
    return {
      ...stored,
      event: { ...stored.event, payload: { ...payload, body: cambio({ ...body }) } },
    };
  }

  it('una clave de más se rechaza: al reescribir el evento desaparecería', async () => {
    const stored = await almacenado(PAYLOADS[4] as ConstitutionPayload);
    expect(() => {
      decodeConstitutionEvent(conCuerpo(stored, (body) => ({ ...body, colado: 1 })));
    }).toThrow(ConstitutionCodecError);
  });

  it('una clave de menos se rechaza: rellenarla con un valor por defecto es inventarla', async () => {
    const stored = await almacenado(PAYLOADS[4] as ConstitutionPayload);
    expect(() => {
      decodeConstitutionEvent(conCuerpo(stored, ({ version: _omitida, ...resto }) => resto));
    }).toThrow(/version.*ausente/iu);
  });

  it('una proporción escrita como número JSON se rechaza', async () => {
    const stored = await almacenado(PAYLOADS[0] as ConstitutionPayload);
    expect(() => {
      decodeConstitutionEvent(
        conCuerpo(stored, (body) => {
          const texto = body['text'] as JsonObject;
          const ordinary = texto['ordinary'] as JsonObject;
          return {
            ...body,
            text: {
              ...texto,
              ordinary: { ...ordinary, approvalOfCensus: { num: 2, den: 3 } },
            },
          };
        }),
      );
    }).toThrow(ConstitutionCodecError);
  });

  it('un motivo de cierre fuera del vocabulario cerrado se rechaza', async () => {
    const stored = await almacenado(PAYLOADS[5] as ConstitutionPayload);
    expect(() => {
      decodeConstitutionEvent(conCuerpo(stored, (body) => ({ ...body, reason: 'porque_si' })));
    }).toThrow(/no está en/u);
  });

  it('un evento de otro agregado no se lee como si fuera constitución', async () => {
    const stored = await almacenado(PAYLOADS[4] as ConstitutionPayload);
    expect(() => {
      decodeConstitutionEvent({
        ...stored,
        event: { ...stored.event, aggregateType: 'decision' },
      });
    }).toThrow(/no es constitution/u);
  });

  it('un tipo de hecho desconocido se rechaza en vez de devolver algo vacío', async () => {
    const stored = await almacenado(PAYLOADS[4] as ConstitutionPayload);
    expect(() => {
      decodeConstitutionEvent({
        ...stored,
        event: { ...stored.event, eventType: 'ConstitutionDerogada' },
      });
    }).toThrow(/no es un evento de la constitución/u);
  });
});
