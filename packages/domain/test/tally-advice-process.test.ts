import { describe, expect, it } from 'vitest';

import { tallyAdviceProcess } from '../src/tally/advice-process.js';
import { buildConfig, buildElectorate, memberIdAt } from './arbitraries.js';
import type { EffectiveBallot } from '../src/index.js';

/**
 * B.9 — El proceso de consejo: decide una persona, después de escuchar.
 *
 * ═══ Qué defiende cada caso ═══
 *
 * Lo que este método promete no es un resultado justo: es una obligación de haber preguntado. Por
 * eso los casos no miran quién ganó —nadie gana— sino las tres cosas que sí se pueden hacer cumplir:
 * que sin consejo suficiente no se pueda decidir, que quien decide pueda ir en contra de todos, y
 * que «nadie decidió» no se confunda con «se decidió que no».
 *
 * Ese último es el que más importa y el más fácil de perder: los dos salen `rejected` y la
 * consecuencia práctica es idéntica —no se adoptó nada—, así que un motivo compartido pasaría
 * desapercibido para siempre. Pero a quien lea el registro dentro de un año le cambia todo: «alguien
 * lo pensó y dijo que no» tiene responsable, «se venció y nadie contestó» tiene un hueco.
 */

const QUIEN_DECIDE = memberIdAt(0);

async function config(minAdvisors: number, censo = 6) {
  return buildConfig({
    electorate: await buildElectorate(censo),
    method: { kind: 'advice-process', decider: QUIEN_DECIDE, minAdvisors },
  });
}

/** Un consejo de la persona `i`, con razones que pasan el mínimo. */
function consejo(
  i: number,
  stance: 'a-favor' | 'en-contra' | 'matiz',
  seq: number,
): EffectiveBallot {
  return {
    voter: memberIdAt(i),
    payload: {
      kind: 'advice',
      stance,
      reasoning: 'Lo pensé y esto es lo que me parece, con razones suficientes para que cuente.',
    },
    weight: 1,
    seq,
    onBehalfOf: [],
  };
}

/** La decisión de quien decide. */
function resuelve(approve: boolean, seq: number): EffectiveBallot {
  return {
    voter: QUIEN_DECIDE,
    payload: { kind: 'binary', approve },
    weight: 1,
    seq,
    onBehalfOf: [],
  };
}

describe('B.9 — proceso de consejo', () => {
  it('sin consejo suficiente no se decide, y NO es un rechazo', async () => {
    // La diferencia importa en pantalla: «falta escuchar» se arregla aconsejando, «se rechazó» no
    // se arregla con nada. Decirle a alguien que su propuesta fue rechazada cuando lo que pasó es
    // que nadie la miró es la clase de mentira que hace que la gente deje de usar esto.
    const cfg = await config(3);
    const resultado = tallyAdviceProcess(cfg, [consejo(1, 'a-favor', 1), resuelve(true, 2)]);

    expect(resultado.outcome.kind).toBe('no-quorum');
    expect(resultado.narrative).toContain('falta escuchar');
  });

  it('con consejo suficiente, quien decide puede resolver EN CONTRA de todos', async () => {
    // Es el método entero en un caso. Si esto saliera «aprobada» porque los tres aconsejaron a
    // favor, esto sería una votación con pasos extra, no un proceso de consejo.
    const cfg = await config(3);
    const resultado = tallyAdviceProcess(cfg, [
      consejo(1, 'a-favor', 1),
      consejo(2, 'a-favor', 2),
      consejo(3, 'a-favor', 3),
      resuelve(false, 4),
    ]);

    expect(resultado.outcome).toEqual({ kind: 'rejected', reason: 'decided-against' });
    expect(resultado.narrative).toContain('El consejo no ata');
  });

  it('y también a favor cuando todos aconsejaron en contra', async () => {
    const cfg = await config(2);
    const resultado = tallyAdviceProcess(cfg, [
      consejo(1, 'en-contra', 1),
      consejo(2, 'en-contra', 2),
      resuelve(true, 3),
    ]);

    expect(resultado.outcome.kind).toBe('approved');
  });

  it('«nadie decidió» y «se decidió que no» NO comparten motivo', async () => {
    const cfg = await config(2);
    const sinDecidir = tallyAdviceProcess(cfg, [consejo(1, 'a-favor', 1), consejo(2, 'matiz', 2)]);
    const decidioQueNo = tallyAdviceProcess(cfg, [
      consejo(1, 'a-favor', 1),
      consejo(2, 'matiz', 2),
      resuelve(false, 3),
    ]);

    expect(sinDecidir.outcome).toEqual({ kind: 'rejected', reason: 'no-decision' });
    expect(decidioQueNo.outcome).toEqual({ kind: 'rejected', reason: 'decided-against' });
    // Y se cuentan distinto en la prosa, que es donde lo lee una persona.
    expect(sinDecidir.narrative).toContain('nadie la resolvió');
    expect(decidioQueNo.narrative).toContain('resolvió que no');
  });

  it('cambiar de parecer no suma un consejo: se cuentan personas, no papeletas', async () => {
    /*
     * Vale la última, como en todo el motor. Acá importa el doble: si cada rectificación sumara,
     * una sola persona podría cumplir el mínimo ella sola aconsejando tres veces — que es
     * exactamente la comedia que el mínimo existe para encarecer.
     */
    const cfg = await config(3);
    const resultado = tallyAdviceProcess(cfg, [
      consejo(1, 'a-favor', 1),
      consejo(1, 'en-contra', 2),
      consejo(1, 'matiz', 3),
      resuelve(true, 4),
    ]);

    expect(resultado.outcome.kind).toBe('no-quorum');
  });

  it('quien decide puede cambiar de parecer, y vale lo último', async () => {
    // Es la conducta que el método quiere fomentar: leer un consejo y rectificar.
    const cfg = await config(2);
    const resultado = tallyAdviceProcess(cfg, [
      consejo(1, 'en-contra', 1),
      consejo(2, 'en-contra', 2),
      resuelve(true, 3),
      resuelve(false, 4),
    ]);

    expect(resultado.outcome).toEqual({ kind: 'rejected', reason: 'decided-against' });
  });

  it('la demostración deja por escrito a quién se le preguntó', async () => {
    // El registro de la consulta ES el producto de este método: permite discutir después la
    // decisión sin tener que discutir si hubo consulta.
    const cfg = await config(2);
    const resultado = tallyAdviceProcess(cfg, [
      consejo(1, 'a-favor', 1),
      consejo(2, 'matiz', 2),
      resuelve(true, 3),
    ]);

    const tabla = resultado.tables[0];
    expect(tabla?.title).toBe('Quién aconsejó');
    expect(tabla?.rows).toHaveLength(2);
    expect(tabla?.rows.map((f) => f[0])).toEqual([memberIdAt(1), memberIdAt(2)]);
    expect(tabla?.rows.map((f) => f[1])).toEqual(['a-favor', 'matiz']);
  });
});
