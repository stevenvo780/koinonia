/**
 * Los calendarios de OpenTimestamps de verdad, ya compuestos: HTTP + reintentos + conjunto.
 *
 * ═══ Por qué estos cuatro y no `a.pool.opentimestamps.org` ═══
 *
 * `a.pool` es un nombre DNS que reparte entre varios calendarios: cada petición cae en **uno**,
 * elegido por el resolutor. Sirve para probar a mano —y por eso el script de comprobación manual lo
 * usa—, pero como configuración de producción es justo lo contrario de lo que hace falta: se cree
 * que se está enviando a varios y se está enviando a uno, con la diferencia de que ahora ni siquiera
 * se sabe a cuál. Nombrar los cuatro es lo que convierte la redundancia en algo comprobable: si uno
 * se cae, el `.ots` lo dice, porque falta su rama.
 *
 * Los cuatro son los que trae por defecto el cliente oficial. Dos los opera la fundación
 * OpenTimestamps, uno Eternity Wall y otro Catallaxy: **no son cuatro nombres del mismo dueño**, que
 * es el error que convierte una lista larga en un solo punto de fallo.
 */

import {
  calendarPool,
  DEFAULT_BACKOFF,
  httpCalendar,
  retryingCalendar,
  type BackoffPolicy,
  type OtsCalendarClient,
  type RetryClock,
} from '@koinonia/anchor';

import { esReintentable, type HttpOptions, nodeFetch } from './http.js';

export const CALENDARIOS_PUBLICOS: readonly string[] = [
  'https://alice.btc.calendar.opentimestamps.org',
  'https://bob.btc.calendar.opentimestamps.org',
  'https://finney.calendar.eternitywall.com',
  'https://btc.calendar.catallaxy.com',
];

/** El agregador de DNS. Sólo para comprobar a mano; en producción se nombran los calendarios. */
export const POOL_DE_PRUEBA = 'https://a.pool.opentimestamps.org';

export interface CalendariosOptions {
  readonly uris?: readonly string[];
  readonly policy?: BackoffPolicy;
  readonly http?: HttpOptions;
  /**
   * Reloj y azar de los reintentos. Por defecto, los del sistema.
   *
   * `Math.random` aquí es correcto y en `packages/anchor` no lo sería: éste es el adaptador, el sitio
   * donde el mundo entra. Lo que no puede pasar es que la **política** dependa de él, y no depende:
   * `backoffDelayMs` es pura y recibe el número.
   */
  readonly clock?: RetryClock;
  /** Cuántos calendarios tienen que sellar. Por defecto 1: que uno se caiga no debe costar nada. */
  readonly minSuccess?: number;
}

export function relojDelSistema(): RetryClock {
  return {
    sleep: (ms) =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref();
      }),
    random: () => Math.random(),
  };
}

/** Un calendario HTTP suelto, con reintentos. */
export function calendarioConReintentos(
  uri: string,
  options: CalendariosOptions = {},
): OtsCalendarClient {
  return retryingCalendar(httpCalendar(uri, nodeFetch(options.http)), {
    policy: options.policy ?? DEFAULT_BACKOFF,
    clock: options.clock ?? relojDelSistema(),
    retryable: esReintentable,
  });
}

/** El conjunto que usa el ciclo de anclaje en producción. */
export function calendariosDeProduccion(options: CalendariosOptions = {}): OtsCalendarClient {
  const uris = options.uris ?? CALENDARIOS_PUBLICOS;
  return calendarPool(
    uris.map((uri) => calendarioConReintentos(uri, options)),
    {
      ...(options.minSuccess === undefined ? {} : { minSuccess: options.minSuccess }),
      uri: uris.join(' '),
    },
  );
}
