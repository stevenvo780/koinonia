/**
 * Proyeccion efimera de carga para ADR-0045.
 *
 * La capacidad exacta vive cifrada en identity; este modulo no la persiste ni la publica. Solo
 * reconstruye, bajo el cerrojo global del ledger que toma quien llama, cuanto trabajo no terminal
 * conserva una persona en el mismo bucket semanal de la tarea que pretende aceptar.
 */

import {
  bogotaCivilToInstant,
  civilFromDays,
  daysFromCivil,
  type InitiativeState,
  type InitiativeTask,
  type Instant,
  instant,
  instantToBogotaCivil,
  type MemberId,
} from '@koinonia/domain';

import type { PgPoolClient } from '../db/client.js';
import {
  INITIATIVE_AGGREGATE_TYPE,
  listAggregateIds,
  loadInitiativeState,
} from '../workspace/repository.js';

const CAPACITY_STATUSES = new Set<InitiativeTask['status']>([
  'aceptada',
  'en-curso',
  'bloqueada',
  'en-apoyo',
  'entregada',
]);

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** Lunes 00:00:00.000 de Bogota que contiene el instante dado. */
export function bogotaWeekStart(value: Instant): Instant {
  const civil = instantToBogotaCivil(value);
  const serialDay = daysFromCivil(civil.year, civil.month, civil.day);
  // 1970-01-01 fue jueves: sumando tres, los lunes quedan en residuo cero.
  const monday = civilFromDays(serialDay - positiveModulo(serialDay + 3, 7));
  return bogotaCivilToInstant({
    ...monday,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
}

/**
 * Una tarea futura carga la semana de vencimiento. Una ya vencida carga la semana vigente, para
 * que mover el calendario no haga desaparecer silenciosamente un compromiso pendiente.
 */
export function taskCapacityBucket(dueAt: Instant, now: Instant): Instant {
  return bogotaWeekStart(dueAt < now ? now : dueAt);
}

export function taskConsumesCapacity(task: InitiativeTask, member: MemberId): boolean {
  return task.assigneeId === member && CAPACITY_STATUSES.has(task.status);
}

/** Funcion pura usada tambien por pruebas de invariantes y por la reconstruccion desde PostgreSQL. */
export function deriveCapacityLoad(
  initiatives: readonly InitiativeState[],
  member: MemberId,
  bucket: Instant,
  now: Instant,
): number {
  let total = 0;
  for (const initiative of initiatives) {
    for (const task of initiative.tasks) {
      if (taskConsumesCapacity(task, member) && taskCapacityBucket(task.dueAt, now) === bucket) {
        total += task.effortMinutes;
        if (!Number.isSafeInteger(total)) {
          throw new RangeError('la carga reconstruida excede el rango entero seguro');
        }
      }
    }
  }
  return total;
}

/**
 * Recorre los streams verificados. Quien llama debe haber tomado antes `lockLedgerWithin`; sin ese
 * corte una segunda aceptacion podria aparecer entre la suma y el append.
 */
export async function deriveCapacityLoadWithin(
  client: PgPoolClient,
  member: MemberId,
  bucket: Instant,
  now: Instant,
): Promise<number> {
  const ids = await listAggregateIds(client, INITIATIVE_AGGREGATE_TYPE);
  const initiatives: InitiativeState[] = [];
  for (const id of ids) initiatives.push(await loadInitiativeState(client, id));
  return deriveCapacityLoad(initiatives, member, bucket, now);
}

/** Convierte un numero ya validado por el reloj de aplicacion al tipo nominal del dominio. */
export function capacityInstant(value: number): Instant {
  return instant(value);
}
