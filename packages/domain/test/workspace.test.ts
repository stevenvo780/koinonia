/**
 * Problemas y propuestas: versionado y autorización comprobada **en el replay**.
 *
 * La prueba central de este fichero es la última sección: se fabrica a mano un log en el que alguien
 * enmienda la propuesta de otra persona —saltándose la orden, que es lo que haría una ruta futura
 * mal escrita o un ataque directo contra el almacén— y se comprueba que **el plegado lo rechaza**.
 * Una autorización que sólo vive en la orden protege el camino que existía el día que se escribió;
 * una que además vive en el plegado protege todos los caminos, incluidos los que no existen todavía.
 */

import { describe, expect, it } from 'vitest';

import {
  type Actor,
  amendProposal,
  attachEvidence,
  appendChained,
  currentVersion,
  draftProposal,
  isChainIntact,
  liveEvidence,
  meTooCount,
  openProblem,
  type ProposalLog,
  type ProposalPayload,
  proposalVersionHash,
  recordMeToo,
  replayProblem,
  replayProposal,
  retractEvidence,
  UnauthorizedError,
  verifyProposalLog,
  versionAt,
} from '../src/index.js';
import { circleIdAt, eventIdAt, memberIdAt, T0 } from './arbitraries.js';
import { instant } from '../src/ids.js';

const CIRCULO = circleIdAt(0);
const PROBLEMA = '0'.repeat(31) + '1';
const PROPUESTA = '0'.repeat(31) + '2';

const daniela: Actor = { memberId: memberIdAt(1), roles: ['member'], circles: [CIRCULO] };
const julian: Actor = { memberId: memberIdAt(2), roles: ['member'], circles: [CIRCULO] };

let reloj = 0;
const meta = (actor: Actor) => ({
  eventId: eventIdAt(++reloj),
  at: instant(T0 + reloj * 1000),
  actor,
});

const TITULO = 'La sala de estudio cierra a las 6 de la tarde';
const CUERPO =
  'Los de la nocturna llegamos a las 5:40 y la sala cierra a las 6. No tenemos dónde leer.';
const TEXTO_PROPUESTA =
  'Radicar una petición a la Dirección para que la sala abra hasta las 9:00 p.m. de lunes a viernes.';

async function problemaBase() {
  return openProblem(meta(daniela), {
    problemId: PROBLEMA,
    title: TITULO,
    body: CUERPO,
    circleId: CIRCULO,
  });
}

async function propuestaBase(): Promise<ProposalLog> {
  return draftProposal(meta(daniela), {
    proposalId: PROPUESTA,
    problemId: PROBLEMA,
    circleId: CIRCULO,
    title: 'Pedir que la sala abra hasta las 9 de la noche',
    body: TEXTO_PROPUESTA,
  });
}

describe('problema', () => {
  it('se abre, se encadena y queda a nombre de quien lo escribió', async () => {
    const log = await problemaBase();
    expect(await isChainIntact(log)).toBe(true);
    const state = replayProblem(log);
    expect(state.exists).toBe(true);
    expect(state.author).toBe(daniela.memberId);
    expect(state.status).toBe('recogiendo-evidencia');
  });

  it('«a mí también me pasa» no se cuenta dos veces por la misma persona', async () => {
    let log = await problemaBase();
    log = await recordMeToo(log, meta(julian));
    expect(meTooCount(replayProblem(log))).toBe(1);
    await expect(recordMeToo(log, meta(julian))).rejects.toThrow(/ya habías dicho/iu);
  });

  it('un aporte exige decir de dónde sale', async () => {
    let log = await problemaBase();
    log = await attachEvidence(log, meta(julian), {
      evidenceId: 'a'.repeat(32),
      certainty: 'me-lo-contaron',
      body: 'Me dijeron que en 2024 ya se había pedido y no respondieron.',
    });
    const aportes = liveEvidence(replayProblem(log));
    expect(aportes).toHaveLength(1);
    expect(aportes[0]?.certainty).toBe('me-lo-contaron');
  });

  it('HORIZONTAL — el aporte lo retira quien lo escribió, y deja un hueco DECLARADO', async () => {
    let log = await problemaBase();
    log = await attachEvidence(log, meta(julian), {
      evidenceId: 'a'.repeat(32),
      certainty: 'visto',
      body: 'El aviso de la puerta dice 6:00 p.m. de lunes a viernes.',
    });

    await expect(
      retractEvidence(log, meta(daniela), {
        evidenceId: 'a'.repeat(32),
        motivation: 'me parece que sobra',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    log = await retractEvidence(log, meta(julian), {
      evidenceId: 'a'.repeat(32),
      motivation: 'me equivoqué: el aviso era del semestre pasado',
    });
    const state = replayProblem(log);
    // No desaparece.
    expect(state.evidence).toHaveLength(1);
    expect(state.evidence[0]?.retracted?.motivation).toMatch(/me equivoqué/u);
    expect(liveEvidence(state)).toHaveLength(0);
  });

  it('retirar exige motivo: un hueco sin motivo es una ausencia silenciosa', async () => {
    let log = await problemaBase();
    log = await attachEvidence(log, meta(julian), {
      evidenceId: 'a'.repeat(32),
      certainty: 'visto',
      body: 'El aviso de la puerta dice 6:00 p.m. de lunes a viernes.',
    });
    await expect(
      retractEvidence(log, meta(julian), { evidenceId: 'a'.repeat(32), motivation: 'nada' }),
    ).rejects.toThrow(/por qué/u);
  });
});

describe('propuesta y versionado', () => {
  it('la V1 sigue INTACTA después de crear la V2', async () => {
    let log = await propuestaBase();
    const v1 = currentVersion(replayProposal(log));
    expect(v1?.version).toBe(1);

    log = await amendProposal(log, meta(daniela), {
      title: 'Pedir que la sala abra hasta las 9 de la noche',
      body: `${TEXTO_PROPUESTA} La vigilancia queda a cargo de la Universidad.`,
      rationale: 'La responsabilidad patrimonial no la pueden asumir estudiantes.',
    });

    const state = replayProposal(log);
    expect(state.versions).toHaveLength(2);

    const v1Despues = versionAt(state, 1);
    expect(v1Despues?.body).toBe(v1?.body);
    expect(v1Despues?.versionHash).toBe(v1?.versionHash);
    expect(v1Despues?.at).toBe(v1?.at);

    const v2 = versionAt(state, 2);
    expect(v2?.versionHash).not.toBe(v1?.versionHash);
    expect(v2?.rationale).toMatch(/patrimonial/u);
  });

  it('el comprobante de cada versión corresponde de verdad a su texto', async () => {
    let log = await propuestaBase();
    log = await amendProposal(log, meta(daniela), {
      title: 'Otro título para la misma propuesta',
      body: `${TEXTO_PROPUESTA} Con vigilancia institucional.`,
      rationale: 'Se corrige quién custodia la llave, que era el punto de la objeción.',
    });
    const state = await verifyProposalLog(log);
    for (const version of state.versions) {
      const recalculado = await proposalVersionHash({
        proposalId: state.proposalId,
        version: version.version,
        title: version.title,
        body: version.body,
      });
      expect(recalculado).toBe(version.versionHash);
    }
  });

  it('HORIZONTAL — la enmienda la hace quien escribió la propuesta', async () => {
    const log = await propuestaBase();
    await expect(
      amendProposal(log, meta(julian), {
        title: 'Pedir que la sala abra las 24 horas',
        body: `${TEXTO_PROPUESTA} Y además los domingos y festivos, todo el día.`,
        rationale: 'creo que hay que pedir más de lo que pide ella',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('enmendar exige decir qué cambia y por qué', async () => {
    const log = await propuestaBase();
    await expect(
      amendProposal(log, meta(daniela), {
        title: 'Pedir que la sala abra hasta las 10 de la noche',
        body: `${TEXTO_PROPUESTA} Hasta las 10 en lugar de las 9.`,
        rationale: 'porque sí',
      }),
    ).rejects.toThrow(/qué cambia y por qué/u);
  });

  it('una enmienda que no cambia nada no es una versión', async () => {
    const log = await propuestaBase();
    await expect(
      amendProposal(log, meta(daniela), {
        title: 'Pedir que la sala abra hasta las 9 de la noche',
        body: TEXTO_PROPUESTA,
        rationale: 'Quería corregir una coma y al final la dejé igual que estaba.',
      }),
    ).rejects.toThrow(/no hay nada que versionar/u);
  });
});

describe('la autorización se comprueba en el REPLAY, no sólo en la orden', () => {
  it('un log fabricado en el que otro enmienda la propuesta ajena NO se pliega', async () => {
    const log = await propuestaBase();

    // Se fabrica el evento saltándose `amendProposal` por completo: es lo que haría una ruta futura
    // mal escrita, un guion de migración descuidado o alguien escribiendo directo en el almacén.
    const versionHash = await proposalVersionHash({
      proposalId: PROPUESTA,
      version: 2,
      title: 'Texto suplantado',
      body: `${TEXTO_PROPUESTA} Esto lo escribió alguien que no es la autora.`,
    });
    const fabricado = await appendChained<ProposalPayload>(log, {
      eventId: eventIdAt(900),
      aggregateId: PROPUESTA,
      occurredAt: instant(T0 + 900_000),
      // El firmante es Julián y la propuesta es de Daniela.
      actor: julian.memberId!,
      payload: {
        type: 'ProposalAmended',
        version: 2,
        title: 'Texto suplantado',
        body: `${TEXTO_PROPUESTA} Esto lo escribió alguien que no es la autora.`,
        versionHash,
        rationale: 'Una justificación suficientemente larga para pasar el mínimo de caracteres.',
      },
    });
    const logFabricado: ProposalLog = [...log, fabricado];

    // La cadena de hashes está PERFECTA: se construyó bien. Lo que falla es la regla de gobierno.
    expect(await isChainIntact(logFabricado)).toBe(true);
    expect(() => replayProposal(logFabricado)).toThrow(/la enmienda quien la escribió/u);
    await expect(verifyProposalLog(logFabricado)).rejects.toThrow(/la enmienda quien la escribió/u);
  });
});
