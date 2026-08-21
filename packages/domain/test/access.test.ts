/**
 * La matriz de autorización, y sobre todo la **horizontal**.
 *
 * La vertical se prueba sola. Lo que hay que forzar es la otra: dos actores con el MISMO rol, y que
 * ninguno pueda tocar lo del otro. Y hay un caso que casi nunca se prueba y es el que abre la
 * puerta: qué pasa cuando el recurso llega **sin autor declarado**. Un sistema que en ese caso deja
 * pasar tiene una escalada horizontal que se activa borrando un campo.
 */

import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  type Actor,
  ANONYMOUS,
  authorize,
  can,
  denialReason,
  isRole,
  ROLES,
  ruleFor,
  UnauthorizedError,
} from '../src/index.js';
import { circleIdAt, memberIdAt } from './arbitraries.js';

const CIRCULO = circleIdAt(0);
const OTRO_CIRCULO = circleIdAt(1);

const daniela: Actor = { memberId: memberIdAt(1), roles: ['member'], circles: [CIRCULO] };
const julian: Actor = { memberId: memberIdAt(2), roles: ['member'], circles: [CIRCULO] };
const lucia: Actor = {
  memberId: memberIdAt(3),
  roles: ['member', 'facilitator'],
  circles: [CIRCULO],
};
const admin: Actor = { memberId: memberIdAt(4), roles: ['tech-admin'], circles: [CIRCULO] };

describe('matriz de autorización', () => {
  it('toda acción tiene regla, y ninguna regla concede a un rol inexistente', () => {
    for (const accion of ACTIONS) {
      const regla = ruleFor(accion);
      expect(regla.roles.length).toBeGreaterThan(0);
      for (const rol of regla.roles) expect(ROLES).toContain(rol);
    }
  });

  it('`isRole` no acepta un rol inventado: un permiso sin nombre no se concede', () => {
    expect(isRole('member')).toBe(true);
    expect(isRole('superadmin')).toBe(false);
    expect(isRole('')).toBe(false);
  });

  it('lo público se lee sin cuenta', () => {
    expect(can(ANONYMOUS, 'problem:read', { kind: 'problem' })).toBe(true);
    expect(can(ANONYMOUS, 'proposal:read', { kind: 'proposal' })).toBe(true);
    expect(can(ANONYMOUS, 'decision:read', { kind: 'decision' })).toBe(true);
    expect(can(ANONYMOUS, 'ledger:export', { kind: 'ledger' })).toBe(true);
  });

  it('escribir exige identidad, y el motivo lo dice', () => {
    expect(denialReason(ANONYMOUS, 'problem:create', { kind: 'problem' })).toBe(
      'NOT_AUTHENTICATED',
    );
    expect(denialReason(ANONYMOUS, 'evidence:attach', { kind: 'evidence' })).toBe(
      'NOT_AUTHENTICATED',
    );
  });
});

describe('autorización VERTICAL', () => {
  it('un miembro no abre ni cierra votaciones: es un encargo', () => {
    expect(denialReason(daniela, 'decision:open', { kind: 'decision', circleId: CIRCULO })).toBe(
      'ROLE_NOT_GRANTED',
    );
    expect(denialReason(daniela, 'decision:close', { kind: 'decision', circleId: CIRCULO })).toBe(
      'ROLE_NOT_GRANTED',
    );
  });

  it('quien facilita sí, pero sólo en SU círculo (subsidiariedad del §3)', () => {
    expect(can(lucia, 'decision:open', { kind: 'decision', circleId: CIRCULO })).toBe(true);
    expect(denialReason(lucia, 'decision:open', { kind: 'decision', circleId: OTRO_CIRCULO })).toBe(
      'NOT_IN_CIRCLE',
    );
  });

  it('sin círculo declarado, una acción por círculo se DENIEGA: fallar cerrado', () => {
    expect(denialReason(lucia, 'decision:open', { kind: 'decision' })).toBe('NOT_IN_CIRCLE');
  });

  it('el administrador técnico no gobierna (§7): la tabla de «no puede», ejecutable', () => {
    for (const accion of [
      'problem:create',
      'evidence:attach',
      'proposal:create',
      'decision:open',
      'decision:close',
      'decision:cast-ballot',
    ] as const) {
      expect(can(admin, accion, { kind: 'decision', circleId: CIRCULO })).toBe(false);
    }
    // Lo que sí puede: leer y exportar, como cualquiera.
    expect(can(admin, 'ledger:export', { kind: 'ledger' })).toBe(true);
  });
});

describe('autorización HORIZONTAL — el mismo rol, y aun así no', () => {
  it('Daniela y Julián tienen el mismo rol y distinta identidad', () => {
    expect(daniela.roles).toEqual(julian.roles);
    expect(daniela.memberId).not.toBe(julian.memberId);
  });

  it('retirar un aporte: sólo quien lo escribió', () => {
    const aporte = { kind: 'evidence' as const, owner: daniela.memberId, circleId: CIRCULO };
    expect(can(daniela, 'evidence:retract', aporte)).toBe(true);
    expect(denialReason(julian, 'evidence:retract', aporte)).toBe('NOT_THE_OWNER');
    // Ni siquiera quien facilita: facilitar es cuidar el procedimiento, no editar lo ajeno (§7).
    expect(denialReason(lucia, 'evidence:retract', aporte)).toBe('NOT_THE_OWNER');
  });

  it('enmendar una propuesta: sólo quien la escribió', () => {
    const propuesta = { kind: 'proposal' as const, owner: daniela.memberId, circleId: CIRCULO };
    expect(can(daniela, 'proposal:amend', propuesta)).toBe(true);
    expect(denialReason(julian, 'proposal:amend', propuesta)).toBe('NOT_THE_OWNER');
  });

  it('votar: el acto se atribuye a quien lo hace y a nadie más', () => {
    expect(
      can(daniela, 'decision:cast-ballot', {
        kind: 'decision',
        subject: daniela.memberId,
        circleId: CIRCULO,
      }),
    ).toBe(true);
    expect(
      denialReason(julian, 'decision:cast-ballot', {
        kind: 'decision',
        subject: daniela.memberId,
        circleId: CIRCULO,
      }),
    ).toBe('NOT_THE_SUBJECT');
  });

  it('«a mí también me pasa» tampoco se dice por otro', () => {
    expect(
      denialReason(julian, 'problem:me-too', { kind: 'problem', subject: daniela.memberId }),
    ).toBe('NOT_THE_SUBJECT');
  });

  it('SIN AUTOR DECLARADO se deniega, no se deja pasar: es la puerta que abre la escalada', () => {
    // El recurso llega sin `owner`. Un sistema que aquí conceda tiene una escalada horizontal que
    // se activa borrando un campo del cuerpo de la petición.
    expect(denialReason(daniela, 'evidence:retract', { kind: 'evidence' })).toBe('OWNER_UNKNOWN');
    expect(denialReason(daniela, 'proposal:amend', { kind: 'proposal' })).toBe('OWNER_UNKNOWN');
    expect(denialReason(daniela, 'decision:cast-ballot', { kind: 'decision' })).toBe(
      'OWNER_UNKNOWN',
    );
  });

  it('el error lleva código estable, la acción y NINGÚN dato personal', () => {
    try {
      authorize(julian, 'proposal:amend', {
        kind: 'proposal',
        owner: daniela.memberId,
        circleId: CIRCULO,
      });
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedError);
      const fallo = error as UnauthorizedError;
      expect(fallo.code).toBe('UNAUTHORIZED_NOT_THE_OWNER');
      expect(fallo.action).toBe('proposal:amend');
      // Ni el identificador de la otra persona aparece en el mensaje: el dominio no filtra a quién
      // pertenece lo que no es tuyo.
      expect(fallo.message).not.toContain(daniela.memberId);
    }
  });
});
