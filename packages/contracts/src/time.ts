const DESFASE_COLOMBIA_MS = 5 * 60 * 60 * 1000;

/**
 * Convierte un `datetime-local` declarado como hora de Colombia.
 *
 * `new Date(valor)` usa la zona del dispositivo y haría que dos personas enviaran instantes
 * distintos al escribir la misma hora. Colombia usa UTC-05:00 sin horario estacional.
 */
export function instanteColombia(valor: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(valor);
  if (match === null) throw new Error('Elegí una fecha y una hora válidas en hora de Colombia.');
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const reconstructed = new Date(localAsUtc);
  if (
    reconstructed.getUTCFullYear() !== year ||
    reconstructed.getUTCMonth() !== month - 1 ||
    reconstructed.getUTCDate() !== day ||
    reconstructed.getUTCHours() !== hour ||
    reconstructed.getUTCMinutes() !== minute
  ) {
    throw new Error('Elegí una fecha y una hora válidas en hora de Colombia.');
  }
  return localAsUtc + DESFASE_COLOMBIA_MS;
}
