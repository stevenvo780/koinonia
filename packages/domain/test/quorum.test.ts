/**
 * Quórum (D.1) y la máquina de qué pasa cuando no se alcanza (D.2).
 */

import { describe, expect, it } from 'vitest';

import {
  checkQuorum,
  circleParticipation,
  type DecisionConfig,
  instant,
  type QuorumSubject,
  quorumFailureAction,
  quorumNarrative,
  ratio,
  sortIds,
  usesApprovalWeight,
} from '../src/index.js';
import {
  buildConfig,
  buildElectorate,
  CIRCLE_MAIN,
  CIRCLE_OTHER,
  CLOSES_AT,
  memberIdAt,
  NO_QUORUM,
  planToMethod,
} from './arbitraries.js';

const HOUR = 3_600_000;

function subject(indices: readonly number[], approveWeight = 0): QuorumSubject {
  const members = sortIds(indices.map(memberIdAt));
  return { represented: members, directVoters: members, approveWeight };
}

async function configWith(
  quorum: DecisionConfig['quorum'],
  members = 10,
  options: { alsoInOtherCircle?: readonly number[] } = {},
): Promise<DecisionConfig> {
  return buildConfig({
    electorate: await buildElectorate(members, {
      ...(options.alsoInOtherCircle === undefined
        ? {}
        : { alsoInOtherCircle: options.alsoInOtherCircle }),
    }),
    method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    quorum,
  });
}

describe('D.1.1 — quórum de participación', () => {
  it('compara `|E| / N` con la fracción exigida, de forma exacta', async () => {
    const config = await configWith({ ...NO_QUORUM, participation: ratio(1, 2) }, 10);
    expect(checkQuorum(config, subject([0, 1, 2, 3])).passed).toBe(false);
    expect(checkQuorum(config, subject([0, 1, 2, 3, 4])).passed).toBe(true); // 5/10 = 1/2, con `≥`
    expect(checkQuorum(config, subject([0, 1, 2, 3, 4, 5])).passed).toBe(true);
  });

  it('la exigencia exacta no se pierde en punto flotante', async () => {
    // 1/3 de 3 personas: exactamente una. Con flotantes, 1/3 = 0.333… y 1/3 ≥ 1/3 depende del azar.
    const config = await configWith({ ...NO_QUORUM, participation: ratio(1, 3) }, 3);
    expect(checkQuorum(config, subject([])).passed).toBe(false);
    expect(checkQuorum(config, subject([0])).passed).toBe(true);
  });

  it('la participación se reporta sin reducir: el par (representados, censo) es lo que se publica', async () => {
    const config = await configWith({ ...NO_QUORUM, participation: ratio(0, 1) }, 10);
    const check = checkQuorum(config, subject([0, 1, 2, 3, 4]));
    expect(check.participation).toEqual({ num: 5n, den: 10n });
  });
});

describe('D.1.2 — quórum de aprobación', () => {
  it('es un piso absoluto de apoyo, independiente del umbral del método', async () => {
    const config = await configWith(
      { ...NO_QUORUM, participation: ratio(0, 1), approvalOfCensus: ratio(1, 3) },
      9,
    );
    expect(checkQuorum(config, subject([0, 1], 2)).detail['approvalOfCensus']).toBe(false);
    expect(checkQuorum(config, subject([0, 1, 2], 3)).detail['approvalOfCensus']).toBe(true);
  });
});

describe('D.1.b — participación directa mínima', () => {
  it('se exige para lo constituyente: la comunidad aparece con su propia mano', async () => {
    const config = await configWith(
      { ...NO_QUORUM, participation: ratio(0, 1), minDirectParticipation: ratio(1, 2) },
      10,
    );
    const pocos: QuorumSubject = {
      represented: sortIds([0, 1, 2, 3, 4, 5].map(memberIdAt)),
      directVoters: sortIds([0].map(memberIdAt)),
      approveWeight: 6,
    };
    expect(checkQuorum(config, pocos).detail['minDirectParticipation']).toBe(false);
    expect(checkQuorum(config, subject([0, 1, 2, 3, 4])).detail['minDirectParticipation']).toBe(
      true,
    );
  });
});

describe('D.1.3 — quórum por círculo', () => {
  it('mide `|E ∩ M_c| / |M_c|` y un círculo vacío NO cumple', async () => {
    const config = await configWith(
      {
        ...NO_QUORUM,
        participation: ratio(0, 1),
        perCircle: [{ circleId: CIRCLE_OTHER, min: ratio(1, 2) }],
      },
      6,
      { alsoInOtherCircle: [0, 1, 2, 3] },
    );
    // 4 personas en CIRCLE_OTHER; con 1 representada no llega al 1/2, con 2 sí.
    expect(checkQuorum(config, subject([0])).detail[`circle_${CIRCLE_OTHER}`]).toBe(false);
    expect(checkQuorum(config, subject([0, 1])).detail[`circle_${CIRCLE_OTHER}`]).toBe(true);

    const sinCirculo = await configWith(
      {
        ...NO_QUORUM,
        participation: ratio(0, 1),
        perCircle: [{ circleId: CIRCLE_OTHER, min: ratio(0, 1) }],
      },
      6,
    );
    // |M_c| = 0 ⇒ no cumple, ni siquiera con una exigencia de 0.
    expect(checkQuorum(sinCirculo, subject([0, 1, 2])).passed).toBe(false);
  });

  it('D.1.d — la participación se atribuye al representado, no al autor de la papeleta', async () => {
    const electorate = await buildElectorate(4, { alsoInOtherCircle: [3] });
    expect(circleParticipation(electorate, [memberIdAt(0)], CIRCLE_OTHER)).toEqual({
      num: 0n,
      den: 1n,
    });
    // Aunque quien firmó la papeleta sea de otro círculo, quien cuenta es el representado.
    expect(circleParticipation(electorate, [memberIdAt(3)], CIRCLE_OTHER)).toEqual({
      num: 1n,
      den: 1n,
    });
    expect(circleParticipation(electorate, [memberIdAt(0)], CIRCLE_MAIN)).toEqual({
      num: 1n,
      den: 4n,
    });
  });
});

describe('D.2 — máquina de quórum no alcanzado', () => {
  it('`reject` cierra y rechaza', async () => {
    const config = await configWith({
      ...NO_QUORUM,
      participation: ratio(1, 2),
      onFailure: 'reject',
    });
    expect(quorumFailureAction(config, 0, CLOSES_AT)).toEqual({ kind: 'reject' });
  });

  it('`extend` prorroga mientras queden prórrogas, y luego rechaza', async () => {
    const config = await configWith({
      participation: ratio(1, 2),
      onFailure: 'extend',
      maxExtensions: 2,
      extensionDuration: 24 * HOUR,
    });
    expect(quorumFailureAction(config, 0, CLOSES_AT)).toEqual({
      kind: 'extend',
      newClosesAt: instant(CLOSES_AT + 24 * HOUR),
    });
    expect(quorumFailureAction(config, 1, CLOSES_AT)).toEqual({
      kind: 'extend',
      newClosesAt: instant(CLOSES_AT + 24 * HOUR),
    });
    // D.2.a: prorrogar indefinidamente equivale a no tener quórum.
    expect(quorumFailureAction(config, 2, CLOSES_AT)).toEqual({ kind: 'reject' });
  });

  it('D.2.c — `escalate` no convierte la decisión en aprobada', async () => {
    const config = await configWith({
      ...NO_QUORUM,
      participation: ratio(1, 2),
      onFailure: 'escalate',
    });
    expect(quorumFailureAction(config, 0, CLOSES_AT)).toEqual({ kind: 'escalate' });
  });
});

describe('quorum — traza legible', () => {
  it('la narrativa nombra los criterios incumplidos, sin jerga', async () => {
    const config = await configWith({ ...NO_QUORUM, participation: ratio(1, 2) }, 10);
    const fallido = checkQuorum(config, subject([0]));
    expect(quorumNarrative(fallido)).toContain('participación mínima');
    expect(quorumNarrative(checkQuorum(config, subject([0, 1, 2, 3, 4])))).toContain(
      'Se alcanzaron',
    );
    expect(usesApprovalWeight(config)).toBe(true);
  });

  it('las claves del detalle son hasheables: `[A-Za-z][A-Za-z0-9_]*`', async () => {
    const config = await configWith(
      {
        ...NO_QUORUM,
        participation: ratio(0, 1),
        approvalOfCensus: ratio(0, 1),
        minDirectParticipation: ratio(0, 1),
        perCircle: [{ circleId: CIRCLE_MAIN, min: ratio(0, 1) }],
      },
      4,
    );
    for (const key of Object.keys(checkQuorum(config, subject([0])).detail)) {
      expect(key).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/u);
    }
  });
});
