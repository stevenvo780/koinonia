/**
 * Ventanas temporales (D.3).
 *
 * ═══ El motor no lee el reloj ═══
 *
 * Aquí no hay `Date.now()`, ni `new Date()`, ni `Intl`, ni una base de datos de husos horarios. El
 * instante entra siempre como parámetro. INV-15 lo formaliza: `tally(cfg, L, now₁) ≡ tally(cfg, L,
 * now₂)`. El bug que esto previene sólo aparece cuando se recomputa un resultado histórico, es
 * decir, **durante la auditoría**, que es el peor momento posible para descubrirlo.
 *
 * ═══ `America/Bogota` ═══
 *
 * DECISIÓN D.3.a: la hora local se convierte a `Instant` **una sola vez**, al configurar la
 * decisión, y se congela dentro de `configHash`. La zona se guarda sólo para renderizar. Colombia
 * es UTC−05:00 y no tiene horario de verano desde 1993, pero la razón para congelar no es que la
 * regla sea estable: es que **puede cambiar**. Si guardáramos «viernes 6:00 p.m. hora de Bogotá» y
 * el país reintrodujera el horario de verano, el cierre de una decisión ya abierta se desplazaría
 * una hora. Un `Instant` congelado es inmune.
 *
 * La conversión civil ↔ instante se hace con aritmética entera pura (algoritmo de Howard Hinnant,
 * *chrono-Compatible Low-Level Date Algorithms*), no con `Date` ni con `Intl`: es reproducible bit a
 * bit en cualquier proceso, con cualquier `TZ` y cualquier `LANG` (INV-14).
 *
 * ═══ El milisegundo del cierre ═══
 *
 * DECISIÓN D.3.b: la ventana es el intervalo **semiabierto** `[opensAt, closesAt)`. Una papeleta es
 * válida ⟺ `opensAt ≤ castAt < closesAt`. Una papeleta con `castAt === closesAt` se **rechaza**.
 * Los intervalos semiabiertos componen sin solape ni hueco —el cierre de una ronda es exactamente la
 * apertura de la siguiente— y eliminan la pregunta «¿el instante del cierre pertenece a antes o a
 * después?». DECISIÓN D.3.d: no hay período de gracia; toda gracia es otro `closesAt` desplazado,
 * con su propio milisegundo límite.
 */

import { type Instant, instant } from './ids.js';

/** Desplazamiento fijo de `America/Bogota`: UTC−05:00, sin horario de verano desde 1993. */
export const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;

/** Una hora civil, tal como la lee una persona. Meses `1..12`, días `1..31`. */
export interface CivilDateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

const MS_PER_DAY = 86_400_000;

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

function floorMod(a: number, b: number): number {
  return a - floorDiv(a, b) * b;
}

/** Días desde 1970-01-01 para una fecha civil proléptica gregoriana (Hinnant, `days_from_civil`). */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = floorDiv(y, 400);
  const yoe = y - era * 400; // [0, 399]
  const doy = floorDiv(153 * (month + (month > 2 ? -3 : 9)) + 2, 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/** Inversa de `daysFromCivil` (Hinnant, `civil_from_days`). */
export function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468;
  const era = floorDiv(z, 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = floorDiv(
    doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096),
    365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100)); // [0, 365]
  const mp = floorDiv(5 * doy + 2, 153); // [0, 11]
  const d = doy - floorDiv(153 * mp + 2, 5) + 1; // [1, 31]
  const m = mp + (mp < 10 ? 3 : -9); // [1, 12]
  return { year: m <= 2 ? y + 1 : y, month: m, day: d };
}

/**
 * Hora civil de Bogotá → `Instant` UTC. Es la única conversión permitida, y ocurre **al configurar**
 * la decisión (D.3.a). El motor jamás la vuelve a hacer.
 */
export function bogotaCivilToInstant(civil: CivilDateTime): Instant {
  const days = daysFromCivil(civil.year, civil.month, civil.day);
  const localMs =
    days * MS_PER_DAY +
    civil.hour * 3_600_000 +
    civil.minute * 60_000 +
    civil.second * 1000 +
    civil.millisecond;
  return instant(localMs - BOGOTA_OFFSET_MS);
}

/** `Instant` UTC → hora civil de Bogotá. Sólo para renderizar. */
export function instantToBogotaCivil(value: Instant): CivilDateTime {
  const localMs = value + BOGOTA_OFFSET_MS;
  const days = floorDiv(localMs, MS_PER_DAY);
  const rest = floorMod(localMs, MS_PER_DAY);
  const { year, month, day } = civilFromDays(days);
  return {
    year,
    month,
    day,
    hour: floorDiv(rest, 3_600_000),
    minute: floorDiv(floorMod(rest, 3_600_000), 60_000),
    second: floorDiv(floorMod(rest, 60_000), 1000),
    millisecond: floorMod(rest, 1000),
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Renderiza un instante en hora de Bogotá, en un formato fijo y sin `Intl`.
 * `2026-08-21 18:00:00.000 (America/Bogota, UTC-05:00)`.
 */
export function formatBogota(value: Instant): string {
  const c = instantToBogotaCivil(value);
  return (
    `${pad(c.year, 4)}-${pad(c.month, 2)}-${pad(c.day, 2)} ` +
    `${pad(c.hour, 2)}:${pad(c.minute, 2)}:${pad(c.second, 2)}.${pad(c.millisecond, 3)} ` +
    '(America/Bogota, UTC-05:00)'
  );
}

/** La ventana efectiva de una decisión: apertura inclusiva, cierre exclusivo. */
export interface EffectiveWindow {
  readonly opensAt: Instant;
  /** Cierre vigente: el programado, más las prórrogas ya emitidas (D.2). */
  readonly closesAt: Instant;
}

/**
 * INV-10 y D.3.b — `opensAt ≤ castAt < closesAt`, sin excepciones ni gracia.
 *
 * El `<` del cierre es el signo más litigioso de toda la especificación: con `<=` se acepta el voto
 * del milisegundo exacto y la ventana deja de componer con la siguiente.
 */
export function isWithinWindow(castAt: Instant, window: EffectiveWindow): boolean {
  return castAt >= window.opensAt && castAt < window.closesAt;
}

/** Posición de un instante respecto de la ventana. Útil para mensajes y para el tick de cierre. */
export function windowStatus(at: Instant, window: EffectiveWindow): 'before' | 'open' | 'after' {
  if (at < window.opensAt) return 'before';
  return at < window.closesAt ? 'open' : 'after';
}

/** ¿La ventana ya venció en `at`? El tick de cierre se dispara con `at >= closesAt`. */
export function isClosedAt(at: Instant, window: EffectiveWindow): boolean {
  return at >= window.closesAt;
}

/**
 * Prórroga (D.2 / A.11): sólo puede **aumentar** el cierre. INV-38 prohíbe retroceder `closesAt`,
 * porque retroceder el cierre a la vista del marcador es cerrar la urna cuando conviene.
 */
export function extendWindow(window: EffectiveWindow, duration: number): EffectiveWindow {
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new RangeError('la duración de la prórroga debe ser un entero positivo de milisegundos');
  }
  return { opensAt: window.opensAt, closesAt: instant(window.closesAt + duration) };
}

/** Piso de deliberación del cierre anticipado (DECISIÓN D.4.c): nunca antes de `opensAt + 24 h`. */
export const DELIBERATION_FLOOR_MS = 24 * 60 * 60 * 1000;

/** ¿`at` respeta el piso de deliberación de 24 h desde la apertura? */
export function respectsDeliberationFloor(at: Instant, window: EffectiveWindow): boolean {
  return at - window.opensAt >= DELIBERATION_FLOOR_MS;
}
