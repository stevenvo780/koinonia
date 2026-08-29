/**
 * `decisionesConDelegacionesVigentes` (`app.ts`): el filtro que evita que una decisión ya cerrada
 * siga aportando delegaciones a `/concentracion`.
 *
 * Se prueba aparte, sin Fastify ni Postgres, porque la función es pura: recibe la forma mínima de
 * `DecisionConEstado` que necesita (`state.status`, `state.delegations`) y no toca I/O. El escenario
 * que motiva el filtro —una decisión cerrada ANTES de su `closesAt` programado, ver el HALLAZGO junto
 * a la función— no es alcanzable hoy desde `/decisiones/:id/cerrar` (sólo cierra por `cause:
 * 'window'`, nunca antes de tiempo), así que esta prueba no puede montarlo de punta a punta contra la
 * API real; prueba en cambio la función misma, que es la defensa contra ese día.
 */

import { describe, expect, it } from 'vitest';

import {
  circleId,
  delegationId,
  instant,
  memberId,
  type Delegation,
  type Instant,
  type LifecycleStatus,
} from '@koinonia/domain';

import { decisionesConDelegacionesVigentes } from '../src/http/app.js';
import type { DecisionConEstado } from '../src/http/service.js';

function hex32(index: number): string {
  return index.toString(16).padStart(32, '0');
}

const AHORA = 1_700_000_000_000 as Instant;

/** Una sola delegación de relleno: a esta prueba no le importa su contenido, sólo que viaje. */
function delegacionDeRelleno(sufijo: number): Delegation {
  return {
    delegationId: delegationId(hex32(0x9000 + sufijo)),
    delegator: memberId(hex32(0x1000 + sufijo)),
    delegate: memberId(hex32(0x2000 + sufijo)),
    scope: { kind: 'circle', circleId: circleId(hex32(0x3000)) },
    grantedAt: instant(AHORA - 1000),
    expiresAt: instant(AHORA + 1000),
    grantedSeq: 1,
  };
}

/**
 * Lo mínimo de `DecisionConEstado` que la función mira: `id` y `log` no importan para este filtro,
 * así que se completan con un valor cualquiera vía `as unknown as DecisionConEstado` — construir un
 * `DecisionState` real (veinte y tantos campos) no aportaría nada a lo que esta prueba comprueba.
 */
function decisionCon(
  status: LifecycleStatus,
  delegations: readonly Delegation[],
): DecisionConEstado {
  return {
    id: `decision-${status}`,
    log: [],
    state: { status, delegations },
  } as unknown as DecisionConEstado;
}

describe('decisionesConDelegacionesVigentes', () => {
  it('conserva las decisiones Open y descarta cualquier otro estado del ciclo de vida', () => {
    const abierta = decisionCon('Open', [delegacionDeRelleno(1)]);
    const cerrada = decisionCon('Closed', [delegacionDeRelleno(2)]);
    const ratificada = decisionCon('Ratified', [delegacionDeRelleno(3)]);
    const rechazada = decisionCon('Rejected', [delegacionDeRelleno(4)]);
    const anulada = decisionCon('Annulled', [delegacionDeRelleno(5)]);
    const borrador = decisionCon('Draft', [delegacionDeRelleno(6)]);

    const resultado = decisionesConDelegacionesVigentes([
      abierta,
      cerrada,
      ratificada,
      rechazada,
      anulada,
      borrador,
    ]);

    expect(resultado).toEqual([abierta]);
  });

  it('con una lista vacía, devuelve una lista vacía', () => {
    expect(decisionesConDelegacionesVigentes([])).toEqual([]);
  });

  it('con varias decisiones Open, conserva todas en el mismo orden — no reordena ni deduplica', () => {
    const primera = decisionCon('Open', [delegacionDeRelleno(1)]);
    const segunda = decisionCon('Open', [delegacionDeRelleno(2)]);
    const cerrada = decisionCon('Closed', [delegacionDeRelleno(3)]);

    expect(decisionesConDelegacionesVigentes([primera, cerrada, segunda])).toEqual([
      primera,
      segunda,
    ]);
  });
});
