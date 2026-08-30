import { describe, expect, it } from 'vitest';

import { ratio } from '../src/fraction.js';
import { tallyConsensus } from '../src/tally/consensus.js';
import type { ConsensusStance, EffectiveBallot } from '../src/index.js';
import { buildConfig, buildElectorate, memberIdAt } from './arbitraries.js';

/**
 * B.10 — Consenso formal: nadie bloquea, y no se apartó demasiada gente.
 *
 * ═══ Qué defiende esta suite, y por qué el método existe ═══
 *
 * La pregunta honesta al añadir un método es «¿esto hace algo que los que ya hay no hacen?». Acá la
 * respuesta es una figura concreta: **apartarse**. `unanimity` pide que todos estén a favor;
 * `sociocratic-consent` pide que nadie objete con daño argumentado. En ninguno de los dos se puede
 * decir «no lo apoyo, no lo voy a impedir, y quiero que conste que no lo apoyo».
 *
 * Y esa figura sólo es un método si tiene consecuencia. Por eso el caso del tope es el central: si
 * apartarse no costara nada, esto sería consentimiento con una etiqueta más. Con el tope, un
 * acuerdo que pasa con la mitad del grupo apartándose deja de aprobarse — que es la diferencia
 * entre un acuerdo y un trámite.
 *
 * El otro caso que importa es que el tope NO se cuente como un rechazo. «Así no, pero no dijimos
 * que no» y «no» se arreglan distinto: el primero se reformula, el segundo no.
 */

const APARTADOS_UN_CUARTO = ratio(1, 4);
const MITAD = ratio(1, 2);

async function config(censo = 8, maxStandAside = APARTADOS_UN_CUARTO) {
  return buildConfig({
    electorate: await buildElectorate(censo),
    method: { kind: 'consensus', maxStandAside, minEngagement: MITAD },
  });
}

function postura(i: number, stance: ConsensusStance, seq: number): EffectiveBallot {
  const razon = 'Lo pensé y esto es exactamente lo que me preocupa, dicho con razones suficientes.';
  return {
    voter: memberIdAt(i),
    payload:
      stance === 'me-aparto' || stance === 'bloqueo'
        ? { kind: 'consensus', stance, razon }
        : { kind: 'consensus', stance },
    weight: 1,
    seq,
    onBehalfOf: [],
  };
}

describe('B.10 — consenso formal', () => {
  it('sin bloqueos y con pocos apartados, hay acuerdo', async () => {
    const cfg = await config(8);
    const resultado = tallyConsensus(cfg, [
      postura(1, 'de-acuerdo', 1),
      postura(2, 'de-acuerdo', 2),
      postura(3, 'con-reservas', 3),
      postura(4, 'me-aparto', 4),
    ]);

    expect(resultado.outcome.kind).toBe('approved');
    // Y lo dice sin fingir entusiasmo, que es la mitad de lo que este método significa.
    expect(resultado.narrative).toContain('Acuerdo no quiere decir entusiasmo');
  });

  it('un solo bloqueo detiene la propuesta, aunque el resto esté a favor', async () => {
    const cfg = await config(8);
    const resultado = tallyConsensus(cfg, [
      postura(1, 'de-acuerdo', 1),
      postura(2, 'de-acuerdo', 2),
      postura(3, 'de-acuerdo', 3),
      postura(4, 'bloqueo', 4),
    ]);

    expect(resultado.outcome).toEqual({ kind: 'rejected', reason: 'objections-pending' });
    expect(resultado.narrative).toContain('Bloquear no es votar en contra');
  });

  it('EL CASO CENTRAL: demasiados apartados tumban el acuerdo aunque nadie bloquee', async () => {
    /*
     * Es lo que hace que «apartarse» sea un método y no una etiqueta. Sin el tope, esto saldría
     * aprobado —nadie bloqueó— y el resultado diría que el grupo acordó algo que la mitad del grupo
     * dijo explícitamente que no apoyaba.
     */
    const cfg = await config(8);
    const resultado = tallyConsensus(cfg, [
      postura(1, 'de-acuerdo', 1),
      postura(2, 'de-acuerdo', 2),
      postura(3, 'me-aparto', 3),
      postura(4, 'me-aparto', 4),
    ]);

    expect(resultado.outcome).toEqual({ kind: 'rejected', reason: 'too-many-stand-asides' });
  });

  it('y ese tope NO se cuenta como un rechazo: se dice que así no, no que no', async () => {
    // Se arreglan distinto. Un rechazo se acata; un «así no» se reformula. Si compartieran motivo,
    // la pantalla no podría decirlo distinto y nadie volvería a intentarlo.
    const cfg = await config(8);
    const resultado = tallyConsensus(cfg, [
      postura(1, 'de-acuerdo', 1),
      postura(2, 'me-aparto', 2),
      postura(3, 'me-aparto', 3),
      postura(4, 'me-aparto', 4),
    ]);

    expect(resultado.outcome).toEqual({ kind: 'rejected', reason: 'too-many-stand-asides' });
    expect(resultado.narrative).toContain('No es un rechazo');
    expect(resultado.narrative).toContain('es que así no');
  });

  it('el bloqueo pesa más que el tope: si hay las dos cosas, se dice que hubo bloqueo', async () => {
    // El orden importa para quien lee el resultado: «te bloquearon» y «te apartaron demasiados» se
    // responden a personas distintas. El bloqueo tiene nombre y motivo escrito; hay a quién ir.
    const cfg = await config(8);
    const resultado = tallyConsensus(cfg, [
      postura(1, 'me-aparto', 1),
      postura(2, 'me-aparto', 2),
      postura(3, 'me-aparto', 3),
      postura(4, 'bloqueo', 4),
    ]);

    expect(resultado.outcome).toEqual({ kind: 'rejected', reason: 'objections-pending' });
  });

  it('sin gente suficiente no hay acuerdo que juzgar, y tampoco es un rechazo', async () => {
    // Un acuerdo firmado por dos de ocho sería un consenso perfecto sobre el papel.
    const cfg = await config(8);
    const resultado = tallyConsensus(cfg, [
      postura(1, 'de-acuerdo', 1),
      postura(2, 'de-acuerdo', 2),
    ]);

    expect(resultado.outcome.kind).toBe('no-quorum');
    expect(resultado.narrative).toContain('No se rechazó');
  });

  it('cambiar de postura vale: se cuenta la última de cada persona', async () => {
    // Alguien que bloqueó y después de discutir se aparta no debe seguir bloqueando el acuerdo.
    const cfg = await config(8);
    const resultado = tallyConsensus(cfg, [
      postura(1, 'de-acuerdo', 1),
      postura(2, 'de-acuerdo', 2),
      postura(3, 'de-acuerdo', 3),
      postura(4, 'bloqueo', 4),
      postura(4, 'me-aparto', 5),
    ]);

    expect(resultado.outcome.kind).toBe('approved');
  });
});
