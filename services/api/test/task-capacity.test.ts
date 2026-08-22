import {
  type InitiativeState,
  type InitiativeTask,
  instant,
  memberId,
  type MemberId,
} from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import {
  bogotaWeekStart,
  deriveCapacityLoad,
  taskCapacityBucket,
  taskConsumesCapacity,
} from '../src/http/task-capacity.js';

const MEMBER = memberId('1'.repeat(32));
const OTHER = memberId('2'.repeat(32));

function task(
  status: InitiativeTask['status'],
  dueAt: number,
  effortMinutes: number,
  assignee: MemberId | undefined = MEMBER,
): InitiativeTask {
  return {
    taskId: '3'.repeat(32) as InitiativeTask['taskId'],
    milestoneId: '4'.repeat(32) as InitiativeTask['milestoneId'],
    title: 'Preparar una evidencia verificable',
    description: 'Preparar una evidencia suficiente para revisar el trabajo colectivo.',
    effortMinutes,
    dueAt: instant(dueAt),
    dependsOn: [],
    status,
    offeredTo: assignee ?? OTHER,
    currentOfferId: '5'.repeat(32) as InitiativeTask['currentOfferId'],
    assigneeId: assignee,
    offers: [],
    responses: [],
    starts: [],
    startedAt: undefined,
    pauses: [],
    currentPause: undefined,
    helpRequests: [],
    evidence: [],
    deliveries: [],
    currentDeliveryId: undefined,
    completedAt: undefined,
    createdAt: instant(dueAt - 1),
    lastSeq: 1,
  };
}

function initiative(tasks: readonly InitiativeTask[]): InitiativeState {
  return { tasks } as InitiativeState;
}

describe('proyeccion efimera de capacidad', () => {
  it('calcula lunes 00:00 de Bogota sin depender de TZ ni Intl', () => {
    // Viernes 2026-08-21 08:00 Bogota -> lunes 2026-08-17 00:00 Bogota.
    expect(bogotaWeekStart(instant(Date.parse('2026-08-21T13:00:00.000Z')))).toBe(
      Date.parse('2026-08-17T05:00:00.000Z'),
    );
    // Domingo de la misma semana no salta al lunes siguiente.
    expect(bogotaWeekStart(instant(Date.parse('2026-08-23T23:59:59.999Z')))).toBe(
      Date.parse('2026-08-17T05:00:00.000Z'),
    );
    expect(bogotaWeekStart(instant(Date.parse('2026-08-24T05:00:00.000Z')))).toBe(
      Date.parse('2026-08-24T05:00:00.000Z'),
    );
  });

  it('carga una tarea vencida a la semana actual y una futura a su semana de vencimiento', () => {
    const now = instant(Date.parse('2026-08-21T13:00:00.000Z'));
    const overdue = instant(Date.parse('2026-08-10T13:00:00.000Z'));
    const future = instant(Date.parse('2026-09-02T13:00:00.000Z'));
    expect(taskCapacityBucket(overdue, now)).toBe(bogotaWeekStart(now));
    expect(taskCapacityBucket(future, now)).toBe(bogotaWeekStart(future));
  });

  it('suma solo compromisos propios, activos y del mismo bucket', () => {
    const now = instant(Date.parse('2026-08-21T13:00:00.000Z'));
    const thisWeek = Date.parse('2026-08-22T13:00:00.000Z');
    const nextWeek = Date.parse('2026-08-29T13:00:00.000Z');
    const states = [
      initiative([
        task('aceptada', thisWeek, 30),
        task('en-curso', thisWeek, 40),
        task('bloqueada', thisWeek, 50),
        task('en-apoyo', thisWeek, 60),
        task('entregada', thisWeek, 70),
        task('completada', thisWeek, 1_000),
        task('rechazada', thisWeek, 1_000, undefined),
        task('reasignacion-solicitada', thisWeek, 1_000, undefined),
        task('ofrecida', thisWeek, 1_000, undefined),
        task('en-curso', thisWeek, 1_000, OTHER),
        task('en-curso', nextWeek, 1_000),
      ]),
    ];
    expect(deriveCapacityLoad(states, MEMBER, bogotaWeekStart(now), now)).toBe(250);
  });

  it('una tarea solo consume cuando conserva assignee y estado no terminal', () => {
    const due = Date.parse('2026-08-22T13:00:00.000Z');
    expect(taskConsumesCapacity(task('entregada', due, 10), MEMBER)).toBe(true);
    expect(taskConsumesCapacity(task('completada', due, 10), MEMBER)).toBe(false);
    expect(taskConsumesCapacity(task('en-curso', due, 10, OTHER), MEMBER)).toBe(false);
  });
});
