/**
 * El padrón congelado: A.1, A.2, A.3 y los invariantes INV-03, INV-04, INV-05, INV-06.
 *
 * Las tres reglas del padrón son contraintuitivas y las tres cierran un ataque concreto. Los tests
 * las nombran por el ataque, no por la regla.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  assertWellFormedElectorate,
  circleSize,
  computeRollHash,
  freezeElectorate,
  instant,
  InvalidElectorateError,
  isEligible,
  isEnrolledAt,
  memberAt,
  membersOfCircle,
  type RegistryEntry,
  verifyRollHash,
} from '../src/index.js';
import { buildElectorate, CIRCLE_MAIN, CIRCLE_OTHER, FC, memberIdAt, T0 } from './arbitraries.js';

const antes = instant(T0 - 1_000_000);

function entry(index: number, overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    memberId: memberIdAt(index),
    enrolledAt: antes,
    circles: [CIRCLE_MAIN],
    ...overrides,
  };
}

describe('electorate — congelación', () => {
  it('INV-06 — el padrón está bien formado: ordenado, sin duplicados, peso base 1', async () => {
    const electorate = await buildElectorate(7);
    assertWellFormedElectorate(electorate);
    expect(electorate.censusSize).toBe(7);
    expect(electorate.members.map((m) => m.memberId)).toEqual(
      [...electorate.members.map((m) => m.memberId)].sort(),
    );
    expect(electorate.members.every((m) => m.baseWeight === 1)).toBe(true);
    expect(electorate.snapshotId).toBe(electorate.rollHash);
  });

  it('el orden de entrada del registro no cambia el `rollHash`', async () => {
    const registry = [entry(3), entry(1), entry(2)];
    const a = await freezeElectorate({
      registry,
      at: T0,
      registryVersion: 1,
      criterion: 'x',
    });
    const b = await freezeElectorate({
      registry: [...registry].reverse(),
      at: T0,
      registryVersion: 1,
      criterion: 'x',
    });
    expect(b.rollHash).toBe(a.rollHash);
    expect(b.members).toEqual(a.members);
  });

  it('el `rollHash` se calcula SÓLO sobre los MemberId: cambiar un estrato no lo mueve', async () => {
    const a = await freezeElectorate({
      registry: [entry(1), entry(2)],
      at: T0,
      registryVersion: 1,
      criterion: 'matriculados activos',
    });
    const b = await freezeElectorate({
      registry: [entry(1, { circles: [CIRCLE_OTHER] }), entry(2)],
      at: T0,
      registryVersion: 9,
      criterion: 'otro criterio distinto',
    });
    expect(b.rollHash).toBe(a.rollHash);
    // Añadir a alguien sí lo mueve: es el conjunto de electores lo que identifica.
    const c = await freezeElectorate({
      registry: [entry(1), entry(2), entry(3)],
      at: T0,
      registryVersion: 1,
      criterion: 'matriculados activos',
    });
    expect(c.rollHash).not.toBe(a.rollHash);
    expect(await computeRollHash([memberIdAt(2), memberIdAt(1)])).toBe(a.rollHash);
    expect(await verifyRollHash(a)).toBe(true);
  });

  it('rechaza un registro con la misma persona dos veces', async () => {
    await expect(
      freezeElectorate({
        registry: [entry(1), entry(1)],
        at: T0,
        registryVersion: 1,
        criterion: 'x',
      }),
    ).rejects.toBeInstanceOf(InvalidElectorateError);
  });

  it('rechaza un criterio vacío o no normalizado en NFC', async () => {
    await expect(
      freezeElectorate({ registry: [entry(1)], at: T0, registryVersion: 1, criterion: '   ' }),
    ).rejects.toBeInstanceOf(InvalidElectorateError);
    await expect(
      freezeElectorate({
        registry: [entry(1)],
        at: T0,
        registryVersion: 1,
        // 'e' + combining acute: se ve como 'é' y hashea distinto.
        criterion: 'matriculados de filosofi\u0301a',
      }),
    ).rejects.toBeInstanceOf(InvalidElectorateError);
  });

  it('detecta un padrón mal formado que llegue ya construido desde fuera', async () => {
    const good = await buildElectorate(3);
    const reversed = { ...good, members: [...good.members].reverse() };
    expect(() => {
      assertWellFormedElectorate(reversed);
    }).toThrow(InvalidElectorateError);
    const wrongSize = { ...good, censusSize: 99 };
    expect(() => {
      assertWellFormedElectorate(wrongSize);
    }).toThrow(InvalidElectorateError);
    const wrongWeight = {
      ...good,
      members: good.members.map((m, i) => (i === 0 ? { ...m, baseWeight: 2 as unknown as 1 } : m)),
    };
    expect(() => {
      assertWellFormedElectorate(wrongWeight);
    }).toThrow(InvalidElectorateError);
    const wrongSnapshot = {
      ...good,
      snapshotId: good.rollHash.replace(/^./u, '0') as typeof good.rollHash,
    };
    expect(() => {
      assertWellFormedElectorate(wrongSnapshot);
    }).toThrow(InvalidElectorateError);
  });
});

describe('electorate — quién entra y quién sale', () => {
  it('INV-03 — quien se matricula al congelar o después NO entra (anti relleno de urna)', () => {
    // La frontera es `enrolledAt < frozenAt`, como INV-03 la formaliza.
    expect(isEnrolledAt(entry(1, { enrolledAt: instant(T0 - 1) }), T0)).toBe(true);
    expect(isEnrolledAt(entry(1, { enrolledAt: T0 }), T0)).toBe(false);
    expect(isEnrolledAt(entry(1, { enrolledAt: instant(T0 + 1) }), T0)).toBe(false);
  });

  it('INV-03 — el padrón congelado ignora un alta posterior aunque la ventana siga abierta', async () => {
    const electorate = await freezeElectorate({
      registry: [entry(1), entry(2), entry(3, { enrolledAt: instant(T0 + 5000) })],
      at: T0,
      registryVersion: 1,
      criterion: 'matriculados activos',
    });
    expect(electorate.censusSize).toBe(2);
    expect(isEligible(electorate, memberIdAt(3))).toBe(false);
  });

  it('A.3 — quien se retira DESPUÉS de congelar permanece en N (anti deserción)', async () => {
    const electorate = await freezeElectorate({
      registry: [
        entry(1),
        entry(2, { withdrawnAt: instant(T0 + 1) }),
        entry(3, { withdrawnAt: T0 }),
        entry(4, { withdrawnAt: instant(T0 - 1) }),
      ],
      at: T0,
      registryVersion: 1,
      criterion: 'matriculados activos',
    });
    // 1: activo. 2 y 3: se van en el instante del cierre o después ⇒ siguen en N.
    // 4: se fue ANTES de congelar ⇒ nunca estuvo en el padrón.
    expect(electorate.censusSize).toBe(3);
    expect(isEligible(electorate, memberIdAt(2))).toBe(true);
    expect(isEligible(electorate, memberIdAt(3))).toBe(true);
    expect(isEligible(electorate, memberIdAt(4))).toBe(false);
  });

  it('INV-02 — la elegibilidad se decide contra el snapshot, no contra un registro vivo', async () => {
    const electorate = await buildElectorate(5);
    expect(isEligible(electorate, memberIdAt(4))).toBe(true);
    expect(isEligible(electorate, memberIdAt(5))).toBe(false);
    expect(memberAt(electorate, memberIdAt(5))).toBeUndefined();
    expect(memberAt(electorate, memberIdAt(0))?.memberId).toBe(memberIdAt(0));
  });

  it('la búsqueda binaria coincide con la búsqueda lineal para todo miembro', async () => {
    const electorate = await buildElectorate(60);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 120 }), (i) => {
        const id = memberIdAt(i);
        const linear = electorate.members.some((m) => m.memberId === id);
        expect(isEligible(electorate, id)).toBe(linear);
      }),
      FC,
    );
  });
});

describe('electorate — círculos (D.1.3)', () => {
  it('cuenta los miembros del círculo y devuelve 0 para un círculo sin nadie', async () => {
    const electorate = await buildElectorate(6, {
      alsoInOtherCircle: [0, 1],
      outsideMainCircle: [5],
    });
    expect(circleSize(electorate, CIRCLE_MAIN)).toBe(5);
    expect(circleSize(electorate, CIRCLE_OTHER)).toBe(2);
    expect(membersOfCircle(electorate, CIRCLE_OTHER)).toEqual([memberIdAt(0), memberIdAt(1)]);
    expect(membersOfCircle(electorate, CIRCLE_MAIN)).not.toContain(memberIdAt(5));
  });
});
