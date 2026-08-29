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
  type Action,
  ACTIONS,
  type Actor,
  ANONYMOUS,
  authorize,
  can,
  denialReason,
  isRole,
  type ResourceRef,
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
const gabriel: Actor = {
  memberId: memberIdAt(5),
  roles: ['guarantees'],
  circles: [CIRCULO],
};
const admin: Actor = { memberId: memberIdAt(4), roles: ['tech-admin'], circles: [CIRCULO] };
/**
 * Las únicas seis acciones de `RULES` con `authenticated: false` (la regla `OPEN`). Es una lista a
 * mano y no `ACTIONS.filter((a) => !ruleFor(a).authenticated)` **a propósito**: si se derivara de
 * `ruleFor`, un mutante que apagara `authenticated` en una acción cerrada haría que el propio test
 * de abajo dejara de mirarla —el filtro se auto-anularía sobre el dato que se supone que vigila—.
 */
const ACCIONES_ABIERTAS: readonly Action[] = [
  'problem:read',
  'proposal:read',
  'decision:read',
  'constitution:read',
  'ledger:read',
  'ledger:export',
];
// Ni «member» ni «tech-admin» abren nada: sirve sólo para que `rule.roles.join(', ')` y
// `actor.roles.join(', ')` tengan DOS elementos cada uno y el separador se note en el mensaje.
const deRolesMixtos: Actor = {
  memberId: memberIdAt(6),
  roles: ['member', 'tech-admin'],
  circles: [CIRCULO],
};

/**
 * El contenido del mensaje, no sólo el `reason`. Hace falta porque `services/api/src/http/app.ts`
 * usa `error.message` como texto que llega a pantalla cuando el código no tiene una traducción
 * propia en `MENSAJES_DELIBERACION` — no es un detalle de depuración interno y sin dueño.
 */
function mensajeDe(actor: Actor, action: Action, resource: ResourceRef): string {
  try {
    authorize(actor, action, resource);
    throw new Error(`se esperaba que ${action} fuera denegado y no lo fue`);
  } catch (error) {
    if (error instanceof UnauthorizedError) return error.message;
    throw error;
  }
}

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

  it('`ACTIONS` trae las 41, sin repetidos: vaciada, el bucle de arriba no notaría nada', () => {
    expect(ACTIONS).toHaveLength(41);
    expect(new Set(ACTIONS).size).toBe(41);
  });

  it('el observador anónimo no tiene identidad ni pertenece a ningún círculo', () => {
    expect(ANONYMOUS.memberId).toBeUndefined();
    expect(ANONYMOUS.roles).toEqual(['observer']);
    expect(ANONYMOUS.circles).toEqual([]);
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
    expect(mensajeDe(ANONYMOUS, 'problem:create', { kind: 'problem' })).toBe(
      'no autorizado para problem:create (NOT_AUTHENTICATED): este acto exige una cuenta ' +
        'verificada con el correo institucional',
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

  it('«sin círculo» y «círculo ajeno» dan el mismo motivo, pero cada uno con SU explicación', () => {
    // Las dos ramas de `circleOnly` devuelven el mismo `DenialReason` a propósito —quien no
    // pertenece al círculo no distingue si el dato faltaba o si el círculo era otro—, pero el
    // mensaje interno sí difiere, porque es el que llega a quien audita el registro. Si una rama se
    // saltara a la otra, la explicación dejaría de corresponder al motivo real de la denegación.
    expect(mensajeDe(lucia, 'decision:open', { kind: 'decision' })).toBe(
      'no autorizado para decision:open (NOT_IN_CIRCLE): el recurso no declara círculo competente ' +
        'y esta acción se decide por círculo (§3)',
    );
    expect(mensajeDe(lucia, 'decision:open', { kind: 'decision', circleId: OTRO_CIRCULO })).toBe(
      'no autorizado para decision:open (NOT_IN_CIRCLE): quien cuida el procedimiento de un ' +
        'círculo tiene que pertenecer a ese círculo (§3)',
    );
  });

  it('cerrar una votación es de facilitación o garantías, y sólo en SU círculo', () => {
    // Sin este positivo, `ownerOnly`, `subjectOnly` y `readerOnly` podrían activarse por error en
    // `decision:close` —ninguno tiene sentido aquí, cerrar no es un acto que se atribuya a nadie— y
    // ningún test lo notaría: la matriz seguiría denegando a Daniela por el motivo de siempre.
    expect(can(lucia, 'decision:close', { kind: 'decision', circleId: CIRCULO })).toBe(true);
    expect(can(gabriel, 'decision:close', { kind: 'decision', circleId: CIRCULO })).toBe(true);
    expect(
      denialReason(lucia, 'decision:close', { kind: 'decision', circleId: OTRO_CIRCULO }),
    ).toBe('NOT_IN_CIRCLE');
  });

  it('avanzar de etapa en la deliberación es de facilitación o garantías, y sólo en SU círculo', () => {
    expect(
      can(lucia, 'deliberation:advance-stage', { kind: 'deliberation', circleId: CIRCULO }),
    ).toBe(true);
    expect(
      denialReason(lucia, 'deliberation:advance-stage', {
        kind: 'deliberation',
        circleId: OTRO_CIRCULO,
      }),
    ).toBe('NOT_IN_CIRCLE');
  });

  it('sin identidad, la falta de cuenta se denuncia ANTES que el rol, en toda acción que la exija', () => {
    // El orden de las comprobaciones en `authorize` importa: `authenticated` se mira antes que
    // `roles`. Un actor sin `memberId` nunca debería enterarse de si el rol le hubiera alcanzado —el
    // motivo correcto es siempre «entrá primero»— y eso sólo se ve pasando por TODAS las acciones
    // que exigen cuenta, no sólo las dos que ya prueba `escribir exige identidad`.
    for (const accion of ACTIONS) {
      if (ACCIONES_ABIERTAS.includes(accion)) continue;
      expect(denialReason(ANONYMOUS, accion, { kind: 'decision' })).toBe('NOT_AUTHENTICATED');
    }
  });

  it('el motivo de rol dice CUÁLES hacían falta y CUÁLES tenía el actor, no sólo que no alcanzaba', () => {
    expect(mensajeDe(deRolesMixtos, 'decision:open', { kind: 'decision', circleId: CIRCULO })).toBe(
      'no autorizado para decision:open (ROLE_NOT_GRANTED): se exige alguno de [facilitator, ' +
        'guarantees] y el actor tiene [member, tech-admin]',
    );
  });

  it('el directorio del círculo sólo se consulta con identidad y membresía vigente', () => {
    for (const actor of [daniela, lucia, gabriel]) {
      expect(can(actor, 'circle:members-read', { kind: 'circle', circleId: CIRCULO })).toBe(true);
    }
    expect(
      denialReason(ANONYMOUS, 'circle:members-read', { kind: 'circle', circleId: CIRCULO }),
    ).toBe('NOT_AUTHENTICATED');
    expect(
      denialReason(daniela, 'circle:members-read', {
        kind: 'circle',
        circleId: OTRO_CIRCULO,
      }),
    ).toBe('NOT_IN_CIRCLE');
    expect(denialReason(admin, 'circle:members-read', { kind: 'circle', circleId: CIRCULO })).toBe(
      'ROLE_NOT_GRANTED',
    );
  });

  it('ratificar exige facilitación o garantías dentro del círculo', () => {
    expect(can(lucia, 'decision:ratify', { kind: 'decision', circleId: CIRCULO })).toBe(true);
    expect(can(gabriel, 'decision:ratify', { kind: 'decision', circleId: CIRCULO })).toBe(true);
    expect(denialReason(daniela, 'decision:ratify', { kind: 'decision', circleId: CIRCULO })).toBe(
      'ROLE_NOT_GRANTED',
    );
    expect(
      denialReason(lucia, 'decision:ratify', { kind: 'decision', circleId: OTRO_CIRCULO }),
    ).toBe('NOT_IN_CIRCLE');
    expect(denialReason(admin, 'decision:ratify', { kind: 'decision', circleId: CIRCULO })).toBe(
      'ROLE_NOT_GRANTED',
    );
  });

  it('el administrador técnico no gobierna (§7): la tabla de «no puede», ejecutable', () => {
    for (const accion of [
      'problem:create',
      'evidence:attach',
      'proposal:create',
      'decision:open',
      'decision:close',
      'decision:ratify',
      'decision:cast-ballot',
      'initiative:plan',
      'task:offer',
      'task:reoffer',
      'task:accept',
      'task:reject',
      'task:request-reassignment',
      'task:start',
      'task:block',
      'task:request-help',
      'task:resume',
      'task:add-evidence',
      'task:deliver',
      'task:read-private-material',
      'task:request-changes',
      'task:accept-review',
    ] as const) {
      expect(can(admin, accion, { kind: 'decision', circleId: CIRCULO })).toBe(false);
    }
    // Lo que sí puede: leer y exportar, como cualquiera.
    expect(can(admin, 'ledger:export', { kind: 'ledger' })).toBe(true);
  });
});

describe('autorización con alcance de ETAPA (ADR-0049)', () => {
  const enPerspectivas = {
    kind: 'deliberation' as const,
    stage: 'perspectivas' as const,
    circleId: CIRCULO,
  };
  const yaCerrada = {
    kind: 'deliberation' as const,
    stage: 'construccion_alternativas' as const,
    circleId: CIRCULO,
  };

  it('mientras la etapa sigue vigente NADIE lee la autoría, ni siquiera quien facilita', () => {
    // Lucía facilita y Gabriel es garantías: el rol más alto del círculo no adelanta el dato.
    for (const actor of [daniela, julian, lucia, gabriel]) {
      expect(denialReason(actor, 'deliberation:read-authorship', enPerspectivas)).toBe(
        'STAGE_STILL_OPEN',
      );
    }
  });

  it('cerrada la etapa, la conceden exactamente los mismos actores', () => {
    for (const actor of [daniela, julian, lucia, gabriel]) {
      expect(can(actor, 'deliberation:read-authorship', yaCerrada)).toBe(true);
    }
  });

  it('en `preguntas_aclaratorias` la autoría SÍ se lee: el alcance no se amplió (ver ADR-0049)', () => {
    // Se consideró ampliar `deniedDuringStage` a esta etapa —una pregunta también se lee distinto
    // según quién la firma— y se descartó con argumento: ADR-0046 y ADR-0049 fijan el mecanismo
    // sobre `perspectivas` dos veces, `PRODUCT.md` narra el anti-anclaje sólo ahí, y ampliar no
    // repararía nada porque quien leyó en vivo ya vio la autoría antes de que `perspectivas` abra.
    // Esta prueba fija esa decisión: si el día de mañana se amplía, tiene que ponerse en rojo aquí.
    const enPreguntas = {
      kind: 'deliberation' as const,
      stage: 'preguntas_aclaratorias' as const,
      circleId: CIRCULO,
    };
    for (const actor of [daniela, julian, lucia, gabriel]) {
      expect(can(actor, 'deliberation:read-authorship', enPreguntas)).toBe(true);
    }
  });

  it('sin etapa declarada se DENIEGA: la ausencia de política nunca concede', () => {
    const sinEtapa = { kind: 'deliberation' as const, circleId: CIRCULO };
    expect(denialReason(daniela, 'deliberation:read-authorship', sinEtapa)).toBe('STAGE_UNKNOWN');
    expect(mensajeDe(daniela, 'deliberation:read-authorship', sinEtapa)).toBe(
      'no autorizado para deliberation:read-authorship (STAGE_UNKNOWN): el recurso no declara la ' +
        'etapa vigente y esta acción se decide por etapa: sin ese dato se deniega, porque la ' +
        'ausencia de política nunca concede acceso',
    );
  });

  it('mientras la etapa sigue vigente, el mensaje nombra la etapa y dice que no es cuestión de rol', () => {
    expect(mensajeDe(daniela, 'deliberation:read-authorship', enPerspectivas)).toBe(
      'no autorizado para deliberation:read-authorship (STAGE_STILL_OPEN): mientras la etapa ' +
        'perspectivas siga vigente este dato no se lee, y no hay ningún rol que lo cambie: la ' +
        'regla es de etapa, no de jerarquía',
    );
  });

  it('la etapa no reemplaza las demás comprobaciones: identidad, rol y círculo siguen', () => {
    expect(denialReason(ANONYMOUS, 'deliberation:read-authorship', yaCerrada)).toBe(
      'NOT_AUTHENTICATED',
    );
    expect(denialReason(admin, 'deliberation:read-authorship', yaCerrada)).toBe('ROLE_NOT_GRANTED');
    expect(
      denialReason({ ...daniela, circles: [OTRO_CIRCULO] }, 'deliberation:read-authorship', {
        ...yaCerrada,
      }),
    ).toBe('NOT_IN_CIRCLE');
  });

  it('es la ÚNICA acción con alcance temporal: ninguna otra mira la etapa', () => {
    for (const accion of ACTIONS) {
      const conEtapa = ruleFor(accion).deniedDuringStage !== undefined;
      expect(conEtapa).toBe(accion === 'deliberation:read-authorship');
    }
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
    expect(
      mensajeDe(julian, 'decision:cast-ballot', {
        kind: 'decision',
        subject: daniela.memberId,
        circleId: CIRCULO,
      }),
    ).toBe(
      'no autorizado para decision:cast-ballot (NOT_THE_SUBJECT): nadie actúa en nombre de otra ' +
        'persona: este acto se atribuiría a alguien que no sos vos',
    );
  });

  it('«a mí también me pasa» tampoco se dice por otro', () => {
    expect(
      denialReason(julian, 'problem:me-too', { kind: 'problem', subject: daniela.memberId }),
    ).toBe('NOT_THE_SUBJECT');
  });

  it('planificación, ofertas y revisión son del responsable inicial y de su círculo', () => {
    for (const action of [
      'initiative:plan',
      'task:offer',
      'task:reoffer',
      'task:request-changes',
      'task:accept-review',
    ] as const) {
      const resource = {
        kind: action === 'initiative:plan' ? ('initiative' as const) : ('task' as const),
        owner: daniela.memberId,
        circleId: CIRCULO,
      };
      expect(can(daniela, action, resource)).toBe(true);
      expect(denialReason(julian, action, resource)).toBe('NOT_THE_OWNER');
      expect(denialReason({ ...daniela, circles: [OTRO_CIRCULO] }, action, resource)).toBe(
        'NOT_IN_CIRCLE',
      );
    }
  });

  it('responder y mover trabajo pertenecen al destinatario o assignee vigente', () => {
    for (const action of [
      'task:accept',
      'task:reject',
      'task:request-reassignment',
      'task:start',
      'task:block',
      'task:request-help',
      'task:resume',
      'task:add-evidence',
      'task:deliver',
    ] as const) {
      const task = { kind: 'task' as const, subject: daniela.memberId, circleId: CIRCULO };
      expect(can(daniela, action, task)).toBe(true);
      expect(denialReason(julian, action, task)).toBe('NOT_THE_SUBJECT');
      expect(denialReason(lucia, action, task)).toBe('NOT_THE_SUBJECT');
      expect(denialReason({ ...daniela, circles: [OTRO_CIRCULO] }, action, task)).toBe(
        'NOT_IN_CIRCLE',
      );
    }
  });

  it('abrir material privado exige estar en la lista cerrada de lectores', () => {
    const material = {
      kind: 'task' as const,
      authorizedReaders: [daniela.memberId!, julian.memberId!],
      circleId: CIRCULO,
    };
    expect(can(daniela, 'task:read-private-material', material)).toBe(true);
    expect(can(julian, 'task:read-private-material', material)).toBe(true);
    expect(denialReason(lucia, 'task:read-private-material', material)).toBe('NOT_A_READER');
    expect(mensajeDe(lucia, 'task:read-private-material', material)).toBe(
      'no autorizado para task:read-private-material (NOT_A_READER): la identidad no está ' +
        'autorizada para abrir este material privado',
    );
    const sinLectores = { kind: 'task' as const, circleId: CIRCULO };
    expect(denialReason(daniela, 'task:read-private-material', sinLectores)).toBe(
      'READERS_UNKNOWN',
    );
    expect(mensajeDe(daniela, 'task:read-private-material', sinLectores)).toBe(
      'no autorizado para task:read-private-material (READERS_UNKNOWN): el material privado no ' +
        'declara lectores; la ausencia de política nunca concede acceso',
    );
    // Una lista declarada pero VACÍA es tan «sin política» como una ausente: ninguna identidad
    // podría estar en ella. Distinto de `sinLectores` porque aquí el campo SÍ está, y vacío.
    expect(
      denialReason(daniela, 'task:read-private-material', {
        ...sinLectores,
        authorizedReaders: [],
      }),
    ).toBe('READERS_UNKNOWN');
    expect(
      denialReason({ ...daniela, circles: [OTRO_CIRCULO] }, 'task:read-private-material', material),
    ).toBe('NOT_IN_CIRCLE');
  });

  it('SIN AUTOR DECLARADO se deniega, no se deja pasar: es la puerta que abre la escalada', () => {
    // El recurso llega sin `owner`. Un sistema que aquí conceda tiene una escalada horizontal que
    // se activa borrando un campo del cuerpo de la petición.
    expect(denialReason(daniela, 'evidence:retract', { kind: 'evidence' })).toBe('OWNER_UNKNOWN');
    expect(mensajeDe(daniela, 'evidence:retract', { kind: 'evidence' })).toBe(
      'no autorizado para evidence:retract (OWNER_UNKNOWN): el evidence no declara autor, y esta ' +
        'acción sólo la puede hacer quien lo escribió',
    );
    expect(denialReason(daniela, 'proposal:amend', { kind: 'proposal' })).toBe('OWNER_UNKNOWN');
    expect(denialReason(daniela, 'decision:cast-ballot', { kind: 'decision' })).toBe(
      'OWNER_UNKNOWN',
    );
    // La misma `DenialReason` sale de dos comprobaciones distintas —`ownerOnly` arriba,
    // `subjectOnly` acá— y cada una explica lo suyo: «autor» no es lo mismo que «a quién se
    // atribuye el acto».
    expect(mensajeDe(daniela, 'decision:cast-ballot', { kind: 'decision' })).toBe(
      'no autorizado para decision:cast-ballot (OWNER_UNKNOWN): el acto no declara a quién se ' +
        'atribuye, y esta acción sólo puede atribuirse a quien la hace',
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
      expect(fallo.name).toBe('UnauthorizedError');
      expect(fallo.code).toBe('UNAUTHORIZED_NOT_THE_OWNER');
      expect(fallo.action).toBe('proposal:amend');
      expect(fallo.message).toBe(
        'no autorizado para proposal:amend (NOT_THE_OWNER): el proposal lo escribió otra ' +
          'persona; tener el mismo rol no da acceso a lo ajeno',
      );
      // Ni el identificador de la otra persona aparece en el mensaje: el dominio no filtra a quién
      // pertenece lo que no es tuyo.
      expect(fallo.message).not.toContain(daniela.memberId);
    }
  });

  it('`can` y `denialReason` sólo atrapan `UnauthorizedError`: cualquier otra cosa sigue subiendo', () => {
    // Un actor deliberadamente inválido —`authorize` no comprueba la FORMA del actor, sólo su
    // permiso— revienta con un `TypeError` al intentar iterar `roles`. Si `can`/`denialReason`
    // atraparan cualquier excepción y la convirtieran en «denegado», un fallo de programación aguas
    // arriba se disfrazaría de decisión legítima de la matriz, en vez de propagarse y hacerse notar.
    const actorRoto = { memberId: undefined, roles: undefined, circles: [] } as unknown as Actor;
    expect(() => can(actorRoto, 'problem:read', { kind: 'problem' })).toThrow(TypeError);
    expect(() => denialReason(actorRoto, 'problem:read', { kind: 'problem' })).toThrow(TypeError);
  });
});
