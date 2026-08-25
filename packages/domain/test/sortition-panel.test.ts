import { describe, expect, it } from 'vitest';

import { PreconditionError, sortObjectionPanel } from '../src/index.js';
import { buildElectorate, CIRCLE_MAIN, memberIdAt, objectionIdAt } from './arbitraries.js';

const SEED_A = 'semilla-administrativa-A|faro-A';
const SEED_B = 'semilla-administrativa-B|faro-B';
const OBJECTOR = memberIdAt(0);
const OBJECTION = objectionIdAt(0);

describe('sorteo del panel de objeciones (B.3.a, ADR-0031, ADR-0032)', () => {
  it('es determinista: la misma semilla produce el mismo panel siempre', async () => {
    const electorate = await buildElectorate(20);
    const first = await sortObjectionPanel({
      electorate,
      circleId: CIRCLE_MAIN,
      objectionId: OBJECTION,
      objector: OBJECTOR,
      panelSize: 3,
      seed: SEED_A,
    });
    const second = await sortObjectionPanel({
      electorate,
      circleId: CIRCLE_MAIN,
      objectionId: OBJECTION,
      objector: OBJECTOR,
      panelSize: 3,
      seed: SEED_A,
    });
    expect(second.panel).toEqual(first.panel);
    expect([...second.tickets.entries()]).toEqual([...first.tickets.entries()]);
  });

  it('semillas distintas producen, en el caso general, paneles distintos', async () => {
    const electorate = await buildElectorate(20);
    const conA = await sortObjectionPanel({
      electorate,
      circleId: CIRCLE_MAIN,
      objectionId: OBJECTION,
      objector: OBJECTOR,
      panelSize: 3,
      seed: SEED_A,
    });
    const conB = await sortObjectionPanel({
      electorate,
      circleId: CIRCLE_MAIN,
      objectionId: OBJECTION,
      objector: OBJECTOR,
      panelSize: 3,
      seed: SEED_B,
    });
    expect(conB.panel).not.toEqual(conA.panel);
  });

  it('B.3.a — quien objeta jamás aparece en su propio panel', async () => {
    const electorate = await buildElectorate(20);
    // Sortea el panel completo (censo del círculo menos quien objeta) para comprobar la exclusión
    // en el caso más exigente: si excluyera mal, con panelSize = |círculo| - 1 el objetante
    // completaría la cuota y aparecería.
    const { panel } = await sortObjectionPanel({
      electorate,
      circleId: CIRCLE_MAIN,
      objectionId: OBJECTION,
      objector: OBJECTOR,
      panelSize: 19,
      seed: SEED_A,
    });
    expect(panel).not.toContain(OBJECTOR);
    expect(panel).toHaveLength(19);
  });

  it('el panel sale sólo del círculo competente, nunca de quien está fuera', async () => {
    // Diez miembros; los índices 5..9 quedan fuera de CIRCLE_MAIN.
    const electorate = await buildElectorate(10, { outsideMainCircle: [5, 6, 7, 8, 9] });
    const afuera = new Set([5, 6, 7, 8, 9].map((i) => memberIdAt(i)));
    const { panel, poolSize } = await sortObjectionPanel({
      electorate,
      circleId: CIRCLE_MAIN,
      objectionId: OBJECTION,
      objector: OBJECTOR,
      panelSize: 3,
      seed: SEED_A,
    });
    // El círculo tiene 5 miembros (0..4); menos quien objeta (0), la bolsa es de 4.
    expect(poolSize).toBe(4);
    for (const member of panel) expect(afuera.has(member)).toBe(false);
  });

  it('un panel más grande que la bolsa disponible se rechaza, no se recorta en silencio', async () => {
    // Círculo de 3 miembros; excluyendo a quien objeta quedan 2, y se pide un panel de 3.
    const electorate = await buildElectorate(3);
    await expect(
      sortObjectionPanel({
        electorate,
        circleId: CIRCLE_MAIN,
        objectionId: OBJECTION,
        objector: OBJECTOR,
        panelSize: 3,
        seed: SEED_A,
      }),
    ).rejects.toThrow(PreconditionError);
  });

  it('un tamaño de panel no positivo se rechaza', async () => {
    const electorate = await buildElectorate(20);
    await expect(
      sortObjectionPanel({
        electorate,
        circleId: CIRCLE_MAIN,
        objectionId: OBJECTION,
        objector: OBJECTOR,
        panelSize: 0,
        seed: SEED_A,
      }),
    ).rejects.toThrow(PreconditionError);
  });

  it('objeciones distintas de la misma persona con la misma semilla no comparten panel por azar', async () => {
    const electorate = await buildElectorate(20);
    const primera = await sortObjectionPanel({
      electorate,
      circleId: CIRCLE_MAIN,
      objectionId: objectionIdAt(0),
      objector: OBJECTOR,
      panelSize: 3,
      seed: SEED_A,
    });
    const segunda = await sortObjectionPanel({
      electorate,
      circleId: CIRCLE_MAIN,
      objectionId: objectionIdAt(1),
      objector: OBJECTOR,
      panelSize: 3,
      seed: SEED_A,
    });
    expect(segunda.panel).not.toEqual(primera.panel);
  });
});
