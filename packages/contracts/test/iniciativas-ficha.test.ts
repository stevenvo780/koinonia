/**
 * Los tres campos de la ficha que el encargo B encontró sin modelar (recursos, riesgos, presupuesto)
 * y la derivación de equipo — pruebas de frontera (Zod) sobre `iniciativas.ts`.
 *
 * Las reglas de negocio y sus invariantes ya están probadas contra `PreconditionError` en
 * `packages/domain/test/{recursos-y-riesgos,presupuesto}.test.ts`; aquí sólo se comprueba que el
 * espejo Zod de frontera acepta y rechaza EXACTAMENTE lo mismo, y que `derivarEquipoIniciativa` lee
 * el estado real que produce el dominio (nunca un objeto inventado a mano).
 */
import {
  acceptTaskBy,
  activateInitiative,
  admitTaskCapacity,
  type Actor,
  circleId,
  createInitiative,
  decisionId,
  type EventId,
  eventId,
  hash,
  initiativeId,
  instant,
  memberId,
  milestoneId,
  offerTaskBy,
  planMilestoneBy,
  prepareTaskAcceptanceBy,
  MAX_RECURSOS_POR_INICIATIVA,
  MAX_RIESGOS_POR_INICIATIVA,
  proposalId,
  replayInitiative,
  type TaskAccepted,
  taskId,
} from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import {
  derivarEquipoIniciativa,
  presupuesto,
  presupuestoCondicional,
  recursoNecesario,
  recursosNecesarios,
  riesgoDeclarado,
  riesgosDeclarados,
  soporte,
} from '../src/iniciativas.js';

const T0 = 1_756_000_000_000;
const CIRCLE = circleId('1'.repeat(32));
const PLAN = {
  objective: 'Conseguir que la sala de estudio extienda su horario nocturno entre semana.',
  responsibleId: memberId('a'.repeat(32)),
  reviewAt: instant(T0 + 60 * 24 * 60 * 60 * 1000),
  successCriteria: [
    {
      description: 'La sala publica y cumple un horario hasta las nueve de la noche.',
      evidenceSource: 'Horario oficial publicado por la biblioteca',
    },
  ],
} as const;

function id32(n: number): string {
  return n.toString(16).padStart(32, '0');
}
function id64(n: number): string {
  return n.toString(16).padStart(64, '0');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// recursoNecesario / recursosNecesarios
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('recursoNecesario / recursosNecesarios', () => {
  it('acepta un recurso bien formado', () => {
    expect(
      recursoNecesario.safeParse({
        categoria: 'espacio',
        descripcion: 'un salón para las diez reuniones semanales',
      }).success,
    ).toBe(true);
  });

  it('rechaza una categoría fuera del vocabulario cerrado', () => {
    expect(
      recursoNecesario.safeParse({ categoria: 'plata-facil', descripcion: 'algo suficiente' })
        .success,
    ).toBe(false);
  });

  it('rechaza una descripción vacía', () => {
    expect(recursoNecesario.safeParse({ categoria: 'otro', descripcion: '' }).success).toBe(false);
  });

  it('la lista vacía es válida: hoy no le falta nada a la iniciativa', () => {
    expect(recursosNecesarios.safeParse([]).success).toBe(true);
  });

  it('rechaza más recursos que el máximo admitido', () => {
    const lista = Array.from({ length: MAX_RECURSOS_POR_INICIATIVA + 1 }, () => ({
      categoria: 'otro' as const,
      descripcion: 'un recurso más de la cuenta permitida por iniciativa',
    }));
    expect(recursosNecesarios.safeParse(lista).success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// riesgoDeclarado / riesgosDeclarados
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('riesgoDeclarado / riesgosDeclarados', () => {
  it('acepta un riesgo bien formado', () => {
    expect(
      riesgoDeclarado.safeParse({
        severidad: 'media',
        descripcion: 'el local reservado podría cancelarse sin aviso',
      }).success,
    ).toBe(true);
  });

  it('rechaza una severidad numérica: nunca una probabilidad libre', () => {
    expect(
      riesgoDeclarado.safeParse({ severidad: 3, descripcion: 'algo suficiente' }).success,
    ).toBe(false);
  });

  it('la lista vacía es válida: hoy no hay ningún riesgo que señalar', () => {
    expect(riesgosDeclarados.safeParse([]).success).toBe(true);
  });

  it('rechaza más riesgos que el máximo admitido', () => {
    const lista = Array.from({ length: MAX_RIESGOS_POR_INICIATIVA + 1 }, () => ({
      severidad: 'baja' as const,
      descripcion: 'un riesgo más de la cuenta permitida por iniciativa',
    }));
    expect(riesgosDeclarados.safeParse(lista).success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// presupuesto / presupuestoCondicional — la condicionalidad en la frontera Zod
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('presupuesto — con soportes, nunca sin ellos', () => {
  const SOPORTE_VALIDO = {
    descripcion: 'cotización del proveedor',
    fuente: 'https://ejemplo.org/x',
  };

  it('acepta un presupuesto bien formado', () => {
    expect(
      presupuesto.safeParse({ montoCentavos: 50_000_00, moneda: 'COP', soportes: [SOPORTE_VALIDO] })
        .success,
    ).toBe(true);
  });

  it('rechaza un presupuesto sin ningún soporte', () => {
    expect(
      presupuesto.safeParse({ montoCentavos: 50_000_00, moneda: 'COP', soportes: [] }).success,
    ).toBe(false);
  });

  it('rechaza un monto no entero', () => {
    expect(
      presupuesto.safeParse({ montoCentavos: 10.5, moneda: 'COP', soportes: [SOPORTE_VALIDO] })
        .success,
    ).toBe(false);
  });

  it('rechaza una moneda que no son tres letras mayúsculas', () => {
    expect(
      presupuesto.safeParse({ montoCentavos: 1000, moneda: 'cop', soportes: [SOPORTE_VALIDO] })
        .success,
    ).toBe(false);
  });

  it('un soporte inválido (fuente vacía) invalida el presupuesto entero', () => {
    expect(soporte.safeParse({ descripcion: 'algo', fuente: '' }).success).toBe(false);
  });
});

describe('presupuestoCondicional — el campo que "ni aparece" cuando no aplica', () => {
  it('undefined es válido: es la forma correcta de decir "no aplica"', () => {
    const resultado = presupuestoCondicional.safeParse(undefined);
    expect(resultado.success).toBe(true);
    expect(resultado.success ? resultado.data : undefined).toBeUndefined();
  });

  it('null se RECHAZA: no es sinónimo válido de "no aplica" (`.optional()`, nunca `.nullable()`)', () => {
    expect(presupuestoCondicional.safeParse(null).success).toBe(false);
  });

  it('un presupuesto real, cuando aplica, se valida con las mismas reglas', () => {
    const resultado = presupuestoCondicional.safeParse({
      montoCentavos: 1_000_00,
      moneda: 'COP',
      soportes: [{ descripcion: 'factura del proveedor', fuente: 'archivo adjunto en el acta' }],
    });
    expect(resultado.success).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// derivarEquipoIniciativa — sobre un InitiativeState real, construido con órdenes del dominio
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('derivarEquipoIniciativa', () => {
  it('lista, ordenados, sólo los MemberId que ya ACEPTARON al menos una tarea', async () => {
    const RESPONSIBLE: Actor = {
      memberId: PLAN.responsibleId,
      roles: ['member'],
      circles: [CIRCLE],
    };
    // Deliberadamente "mayor" en orden de bytes que RECIPIENT_LOW, para comprobar que
    // derivarEquipoIniciativa ordena y no sólo devuelve en orden de aparición.
    const RECIPIENT_HIGH: Actor = {
      memberId: memberId('f'.repeat(32)),
      roles: ['member'],
      circles: [CIRCLE],
    };
    const RECIPIENT_LOW: Actor = {
      memberId: memberId('2'.repeat(32)),
      roles: ['member'],
      circles: [CIRCLE],
    };
    const RECIPIENT_SIN_ACEPTAR: Actor = {
      memberId: memberId('9'.repeat(32)),
      roles: ['member'],
      circles: [CIRCLE],
    };

    let seq = 1;
    const meta = (
      actor: Actor,
    ): { eventId: EventId; at: ReturnType<typeof instant>; by: Actor } => {
      const n = seq++;
      return { eventId: eventId(id32(n)), at: instant(T0 + n * 1_000), by: actor };
    };
    const metaSistema = (): {
      eventId: EventId;
      at: ReturnType<typeof instant>;
      actor: 'system';
    } => {
      const n = seq++;
      return { eventId: eventId(id32(n)), at: instant(T0 + n * 1_000), actor: 'system' as const };
    };

    const created = await createInitiative(metaSistema(), {
      initiativeId: initiativeId(id32(500)),
      outcomeKind: 'approved',
      decisionId: decisionId(id32(900)),
      proposalId: proposalId(id32(901)),
      proposalVersionHash: hash(id64(1)),
      decisionResultHash: hash(id64(2)),
      circleId: CIRCLE,
      executionPlan: PLAN,
    });
    const activated = await activateInitiative(created, metaSistema(), {
      ratificationEventId: eventId(id32(800)),
      ratificationEventHash: hash(id64(3)),
    });
    const MILESTONE = milestoneId(id32(501));
    let log = await planMilestoneBy(activated, meta(RESPONSIBLE), {
      milestoneId: MILESTONE,
      title: 'Primer hito verificable',
      completionCriterion: 'Existe evidencia pública de que el hito terminó.',
      dueAt: instant(PLAN.reviewAt - 1_000),
    });

    // Antes de cualquier oferta: equipo vacío.
    expect(derivarEquipoIniciativa(replayInitiative(log))).toEqual([]);

    async function ofrecerYAceptar(idNum: number, recipient: Actor) {
      const task = taskId(id32(idNum));
      const offerMeta = meta(RESPONSIBLE);
      log = await offerTaskBy(log, offerMeta, {
        taskId: task,
        milestoneId: MILESTONE,
        offeredTo: recipient.memberId!,
        recipient,
        title: 'Preparar evidencia del hito',
        description: 'Reunir y publicar la evidencia verificable de este hito.',
        effortMinutes: 60,
        dueAt: instant(PLAN.reviewAt - 2_000),
        dependsOn: [],
      });
      const revision = replayInitiative(log).tasks.find((t) => t.taskId === task)?.lastSeq;
      if (revision === undefined) throw new Error('la prueba exige la tarea vigente');
      const acceptInput: Omit<TaskAccepted, 'type'> = {
        taskId: task,
        offerId: offerMeta.eventId,
        expectedTaskSeq: revision,
      };
      const acceptMeta = meta(recipient);
      const candidate = prepareTaskAcceptanceBy(log, acceptMeta, acceptInput);
      log = await acceptTaskBy(
        log,
        acceptMeta,
        acceptInput,
        admitTaskCapacity(candidate, { currentLoadMinutes: 0, weeklyCapacityMinutes: 10_080 }),
      );
    }

    await ofrecerYAceptar(502, RECIPIENT_HIGH);
    await ofrecerYAceptar(503, RECIPIENT_LOW);

    // Tercera tarea: ofrecida pero NUNCA aceptada — no debe aparecer en el equipo.
    const taskSinAceptar = taskId(id32(504));
    log = await offerTaskBy(log, meta(RESPONSIBLE), {
      taskId: taskSinAceptar,
      milestoneId: MILESTONE,
      offeredTo: RECIPIENT_SIN_ACEPTAR.memberId!,
      recipient: RECIPIENT_SIN_ACEPTAR,
      title: 'Tarea que nadie acepta todavía',
      description: 'Sigue ofrecida al cierre de esta prueba, sin ninguna respuesta.',
      effortMinutes: 30,
      dueAt: instant(PLAN.reviewAt - 3_000),
      dependsOn: [],
    });

    const equipo = derivarEquipoIniciativa(replayInitiative(log));

    expect(equipo).toEqual([RECIPIENT_LOW.memberId, RECIPIENT_HIGH.memberId]);
    expect(equipo).not.toContain(RECIPIENT_SIN_ACEPTAR.memberId);
    // Determinismo: orden de bytes de MemberId, no orden de aceptación (HIGH aceptó primero).
    expect(equipo[0]).toBe(RECIPIENT_LOW.memberId);
  });
});
