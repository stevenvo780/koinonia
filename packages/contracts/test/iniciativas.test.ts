/**
 * Prueba con evidencia el hallazgo del fichero que examina: el dominio sostiene cuatro columnas del
 * Kanban de PRODUCT.md §4, no cinco. Construye agregados `InitiativeState` reales con las órdenes del
 * dominio (nunca objetos inventados a mano) y comprueba que `derivarEstadoTableroIniciativa` lee
 * exactamente lo que esas órdenes dejaron escrito.
 */
import {
  acceptTaskBy,
  activateInitiative,
  addTaskEvidenceBy,
  admitTaskCapacity,
  type Actor,
  blockTaskBy,
  circleId,
  createInitiative,
  decisionId,
  deliverTaskBy,
  type EventId,
  eventId,
  hash,
  type InitiativeLog,
  initiativeId,
  instant,
  memberId,
  milestoneId,
  type MilestoneId,
  offerTaskBy,
  planMilestoneBy,
  prepareTaskAcceptanceBy,
  proposalId,
  replayInitiative,
  requestTaskHelpBy,
  resumeTaskBy,
  startTaskBy,
  type TaskAccepted,
  taskId,
  type TaskId,
  toPrivateMaterialCommitment,
} from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import {
  derivarAvanceIniciativa,
  derivarEstadoTableroIniciativa,
  ESTADO_TABLERO_INICIATIVA_EN_PALABRAS,
  estadoTableroIniciativa,
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

const RESPONSIBLE: Actor = { memberId: PLAN.responsibleId, roles: ['member'], circles: [CIRCLE] };
const RECIPIENT: Actor = {
  memberId: memberId('b'.repeat(32)),
  roles: ['member'],
  circles: [CIRCLE],
};
const RECIPIENT_2: Actor = {
  memberId: memberId('c'.repeat(32)),
  roles: ['member'],
  circles: [CIRCLE],
};

/** 32 caracteres hex válidos y distintos por número — para IDs de agregado, hito y tarea. */
function id32(n: number): string {
  return n.toString(16).padStart(32, '0');
}

/** 64 caracteres hex válidos — para huellas. */
function id64(n: number): string {
  return n.toString(16).padStart(64, '0');
}

/** Reloj de la prueba: cada acto siguiente ocurre un segundo después del anterior. */
class Reloj {
  private siguienteEvento = 1;

  metaDe(actor: Actor): {
    readonly eventId: EventId;
    readonly at: ReturnType<typeof instant>;
    readonly by: Actor;
  } {
    const n = this.siguienteEvento++;
    return { eventId: eventId(id32(n)), at: instant(T0 + n * 1_000), by: actor };
  }

  eventoSistema(): {
    readonly eventId: EventId;
    readonly at: ReturnType<typeof instant>;
    readonly actor: 'system';
  } {
    const n = this.siguienteEvento++;
    return { eventId: eventId(id32(n)), at: instant(T0 + n * 1_000), actor: 'system' as const };
  }
}

function revisionOf(log: InitiativeLog, task: TaskId): number {
  const revision = replayInitiative(log).tasks.find((t) => t.taskId === task)?.lastSeq;
  if (revision === undefined) throw new Error('la prueba exige la tarea vigente');
  return revision;
}

/** Crea, activa y planifica un hito. Cada prueba pasa un `sufijo` distinto para no chocar IDs. */
async function iniciativaActivaConHito(
  reloj: Reloj,
  sufijo: number,
): Promise<{ log: InitiativeLog; milestone: MilestoneId }> {
  const created = await createInitiative(reloj.eventoSistema(), {
    initiativeId: initiativeId(id32(sufijo)),
    outcomeKind: 'approved',
    decisionId: decisionId(id32(900)),
    proposalId: proposalId(id32(901)),
    proposalVersionHash: hash(id64(1)),
    decisionResultHash: hash(id64(2)),
    circleId: CIRCLE,
    executionPlan: PLAN,
  });
  const activated = await activateInitiative(created, reloj.eventoSistema(), {
    ratificationEventId: eventId(id32(800)),
    ratificationEventHash: hash(id64(3)),
  });
  const milestone = milestoneId(id32(sufijo + 1));
  const log = await planMilestoneBy(activated, reloj.metaDe(RESPONSIBLE), {
    milestoneId: milestone,
    title: 'Primer hito verificable',
    completionCriterion: 'Existe evidencia pública de que el hito terminó.',
    dueAt: instant(PLAN.reviewAt - 1_000),
  });
  return { log, milestone };
}

/** Ofrece, acepta y comienza una tarea. Deja la tarea en `en-curso`. */
async function tareaEnCurso(
  reloj: Reloj,
  log: InitiativeLog,
  milestone: MilestoneId,
  task: TaskId,
  recipient: Actor,
): Promise<{ log: InitiativeLog; offerId: EventId }> {
  const offerMeta = reloj.metaDe(RESPONSIBLE);
  let next = await offerTaskBy(log, offerMeta, {
    taskId: task,
    milestoneId: milestone,
    offeredTo: recipient.memberId!,
    recipient,
    title: 'Preparar evidencia del hito',
    description: 'Reunir y publicar la evidencia verificable de este hito.',
    effortMinutes: 60,
    dueAt: instant(PLAN.reviewAt - 2_000),
    dependsOn: [],
  });
  const offerId = offerMeta.eventId;
  const acceptInput: Omit<TaskAccepted, 'type'> = {
    taskId: task,
    offerId,
    expectedTaskSeq: revisionOf(next, task),
  };
  const acceptMeta = reloj.metaDe(recipient);
  const candidate = prepareTaskAcceptanceBy(next, acceptMeta, acceptInput);
  next = await acceptTaskBy(
    next,
    acceptMeta,
    acceptInput,
    admitTaskCapacity(candidate, { currentLoadMinutes: 0, weeklyCapacityMinutes: 10_080 }),
  );
  next = await startTaskBy(next, reloj.metaDe(recipient), {
    taskId: task,
    offerId,
    expectedTaskSeq: revisionOf(next, task),
  });
  return { log: next, offerId };
}

describe('derivarEstadoTableroIniciativa — evidencia de las columnas que el dominio sostiene', () => {
  it('una iniciativa recién resultada, sin ratificar, está por-empezar', async () => {
    const reloj = new Reloj();
    const created = await createInitiative(reloj.eventoSistema(), {
      initiativeId: initiativeId(id32(1)),
      outcomeKind: 'approved',
      decisionId: decisionId(id32(900)),
      proposalId: proposalId(id32(901)),
      proposalVersionHash: hash(id64(1)),
      decisionResultHash: hash(id64(2)),
      circleId: CIRCLE,
      executionPlan: PLAN,
    });
    const state = replayInitiative(created);
    expect(state.activatedAt).toBeUndefined();
    expect(derivarEstadoTableroIniciativa(state)).toBe('por-empezar');
  });

  it('ratificada y sin tareas en curso está en-curso: el portón que abre ADR-0044 ya es el hecho', async () => {
    const reloj = new Reloj();
    const { log } = await iniciativaActivaConHito(reloj, 10);
    const state = replayInitiative(log);
    expect(state.activatedAt).toBeDefined();
    expect(derivarEstadoTableroIniciativa(state)).toBe('en-curso');
  });

  it('una tarea bloqueada (TaskBlocked) pinta la iniciativa entera bloqueada, y reanudar la devuelve a en-curso', async () => {
    const reloj = new Reloj();
    const { log: base, milestone } = await iniciativaActivaConHito(reloj, 20);
    const TASK = taskId(id32(21));
    const { log: enCurso, offerId } = await tareaEnCurso(reloj, base, milestone, TASK, RECIPIENT);

    const blockMeta = reloj.metaDe(RECIPIENT);
    const blocked = await blockTaskBy(enCurso, blockMeta, {
      taskId: TASK,
      offerId,
      expectedTaskSeq: revisionOf(enCurso, TASK),
      category: 'dependencia',
    });
    const state = replayInitiative(blocked);
    expect(state.tasks[0]?.status).toBe('bloqueada');
    expect(derivarEstadoTableroIniciativa(state)).toBe('bloqueada');

    const resumed = await resumeTaskBy(blocked, reloj.metaDe(RECIPIENT), {
      taskId: TASK,
      offerId,
      expectedTaskSeq: revisionOf(blocked, TASK),
      pauseId: blockMeta.eventId,
    });
    expect(derivarEstadoTableroIniciativa(replayInitiative(resumed))).toBe('en-curso');
  });

  it('pedir ayuda (en-apoyo) también pinta la iniciativa bloqueada: ADR-0044 dice que ambas detienen el reloj', async () => {
    const reloj = new Reloj();
    const { log: base, milestone } = await iniciativaActivaConHito(reloj, 30);
    const TASK = taskId(id32(31));
    const { log: enCurso, offerId } = await tareaEnCurso(reloj, base, milestone, TASK, RECIPIENT);

    const helped = await requestTaskHelpBy(enCurso, reloj.metaDe(RECIPIENT), {
      taskId: TASK,
      offerId,
      expectedTaskSeq: revisionOf(enCurso, TASK),
      category: 'orientacion',
    });
    const state = replayInitiative(helped);
    expect(state.tasks[0]?.status).toBe('en-apoyo');
    expect(derivarEstadoTableroIniciativa(state)).toBe('bloqueada');
  });

  it('una entrega sin revisar pinta en-revision', async () => {
    const reloj = new Reloj();
    const { log: base, milestone } = await iniciativaActivaConHito(reloj, 40);
    const TASK = taskId(id32(41));
    const { log: enCurso, offerId } = await tareaEnCurso(reloj, base, milestone, TASK, RECIPIENT);

    const evidenceMeta = reloj.metaDe(RECIPIENT);
    const withEvidence = await addTaskEvidenceBy(enCurso, evidenceMeta, {
      taskId: TASK,
      offerId,
      expectedTaskSeq: revisionOf(enCurso, TASK),
      objectCommitment: toPrivateMaterialCommitment(id64(50)),
      kindCode: 'documento',
      sizeClass: 'pequena',
      visibility: 'restricted',
    });
    const delivered = await deliverTaskBy(withEvidence, reloj.metaDe(RECIPIENT), {
      taskId: TASK,
      offerId,
      expectedTaskSeq: revisionOf(withEvidence, TASK),
      evidenceIds: [evidenceMeta.eventId],
      summaryCommitment: toPrivateMaterialCommitment(id64(51)),
    });
    const state = replayInitiative(delivered);
    expect(state.tasks[0]?.status).toBe('entregada');
    expect(derivarEstadoTableroIniciativa(state)).toBe('en-revision');
  });

  it('bloqueada gana sobre en-revision cuando coexisten (prioridad documentada en el presentador)', async () => {
    const reloj = new Reloj();
    const { log: base, milestone } = await iniciativaActivaConHito(reloj, 60);
    const TASK_A = taskId(id32(61));
    const TASK_B = taskId(id32(62));

    const conA = await tareaEnCurso(reloj, base, milestone, TASK_A, RECIPIENT);
    const conAmbas = await tareaEnCurso(reloj, conA.log, milestone, TASK_B, RECIPIENT_2);

    const blockMeta = reloj.metaDe(RECIPIENT);
    let log = await blockTaskBy(conAmbas.log, blockMeta, {
      taskId: TASK_A,
      offerId: conA.offerId,
      expectedTaskSeq: revisionOf(conAmbas.log, TASK_A),
      category: 'recurso',
    });

    const evidenceMeta = reloj.metaDe(RECIPIENT_2);
    log = await addTaskEvidenceBy(log, evidenceMeta, {
      taskId: TASK_B,
      offerId: conAmbas.offerId,
      expectedTaskSeq: revisionOf(log, TASK_B),
      objectCommitment: toPrivateMaterialCommitment(id64(70)),
      kindCode: 'documento',
      sizeClass: 'pequena',
      visibility: 'restricted',
    });
    log = await deliverTaskBy(log, reloj.metaDe(RECIPIENT_2), {
      taskId: TASK_B,
      offerId: conAmbas.offerId,
      expectedTaskSeq: revisionOf(log, TASK_B),
      evidenceIds: [evidenceMeta.eventId],
      summaryCommitment: toPrivateMaterialCommitment(id64(71)),
    });

    const state = replayInitiative(log);
    const statuses = state.tasks.map((t) => t.status).sort();
    expect(statuses).toEqual(['bloqueada', 'entregada']);
    expect(derivarEstadoTableroIniciativa(state)).toBe('bloqueada');
  });
});

describe('derivarAvanceIniciativa — conteo del colectivo, nunca de una persona (ADR-0039/0040)', () => {
  it('cuenta hitos y tareas totales/completas sin nombrar a nadie', async () => {
    const reloj = new Reloj();
    const { log } = await iniciativaActivaConHito(reloj, 80);
    const state = replayInitiative(log);
    expect(derivarAvanceIniciativa(state)).toEqual({
      hitos: 1,
      tareasTotales: 0,
      tareasCompletas: 0,
    });
  });
});

describe('el enum y su traducción a pantalla', () => {
  it('tiene exactamente cuatro estados: los que el dominio puede demostrar hoy, no los cinco de PRODUCT.md', () => {
    expect(estadoTableroIniciativa.options).toEqual([
      'por-empezar',
      'en-curso',
      'bloqueada',
      'en-revision',
    ]);
  });

  it('cada estado tiene su palabra en pantalla y ninguna es jerga prohibida', () => {
    for (const valor of estadoTableroIniciativa.options) {
      expect(ESTADO_TABLERO_INICIATIVA_EN_PALABRAS[valor]).toBeTruthy();
    }
  });
});
