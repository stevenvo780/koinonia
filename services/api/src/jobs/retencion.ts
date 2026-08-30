/**
 * La tarea que de verdad BORRA lo que el ADR-0055 promete no guardar para siempre.
 *
 * ═══ Por qué existe ═══
 *
 * Las tres funciones de purga estaban escritas, probadas y desplegadas desde hacía semanas, y
 * **nadie las llamaba**. Ni al arrancar, ni por temporizador, ni desde ninguna ruta: una auditoría
 * las buscó con `git grep` y sólo aparecían en su propia declaración y en el reexport del barril.
 * `purgeOldConsumptions` ni siquiera se reexportaba.
 *
 * O sea que la retención existía como código y no como conducta. Es el mismo patrón que ya mordió
 * dos veces en este proyecto —el paquete verificable que ninguna ruta servía, el desestimar una
 * objeción que ninguna pantalla alcanzaba—: construido e inalcanzable, que es peor que faltante,
 * porque nadie lo echa de menos.
 *
 * Hoy son catorce filas porque todavía no hay gente. En cuanto entren personas de verdad,
 * `identity.rate_bucket` e `identity.rate_consumption` crecen sin tope y conservan el rastro de
 * quién pidió qué y cuándo mucho más allá de la ventana declarada. Y ese rastro es exactamente lo
 * que el propio comentario de `rate-limit.ts` llama «una fuente de identidad débil».
 *
 * ═══ Qué barre, y qué NO ═══
 *
 * Sólo las tres tablas de identidad y control de abuso, que son datos operativos con fecha de
 * caducidad declarada. **El historial no se toca ni se puede tocar**: es de sólo-anexar, ninguna de
 * estas tres consultas lo menciona, y el verificador independiente cazaría el hueco si alguien lo
 * intentara. Borrar acá es cumplir la retención, no reescribir la historia.
 *
 * ═══ Una pasada al arrancar, además de la periódica ═══
 *
 * Copiado de lo que ya aprendió la tarea de anclaje, y por su misma razón (ver `anchor/tarea.ts`):
 * si sólo se programaran temporizadores, cada despliegue reiniciaría el reloj y con despliegues
 * seguidos la purga podría no correr nunca. Es idempotente —borra lo vencido, y si no hay nada
 * vencido no borra nada—, así que repetirla no cuesta ni rompe.
 */

import type { PgPool } from '../db/client.js';
import type { ClockPort } from '../http/ports.js';
import { purgeExpiredLinks } from '../http/identity.js';
import { purgeOldBuckets, purgeOldConsumptions } from '../http/rate-limit.js';

/** Cada cuánto se barre. Una hora: la ventana más larga que se guarda es de días, no de minutos. */
const CADA_MS = 60 * 60 * 1000;

export interface TareaDeRetencion {
  arrancar(): void;
  detener(): void;
  /** Una pasada, ahora. Devuelve cuántas filas se borraron de cada sitio. Existe para las pruebas. */
  barrer(): Promise<{
    readonly enlaces: number;
    readonly cupos: number;
    readonly consumos: number;
  }>;
}

export interface OpcionesDeRetencion {
  readonly pool: PgPool;
  readonly clock: ClockPort;
  /** A dónde va el parte. Se inyecta para que las pruebas no escriban en la salida del proceso. */
  readonly diario?: (linea: string) => void;
  /** Cada cuánto barrer. Sólo se toca en pruebas; en producción manda `CADA_MS`. */
  readonly cadaMs?: number;
}

export function crearTareaDeRetencion(opciones: OpcionesDeRetencion): TareaDeRetencion {
  const diario = opciones.diario ?? ((linea) => process.stdout.write(`[retención] ${linea}\n`));
  const cadaMs = opciones.cadaMs ?? CADA_MS;
  let temporizador: NodeJS.Timeout | undefined;

  async function barrer(): Promise<{ enlaces: number; cupos: number; consumos: number }> {
    const client = await opciones.pool.connect();
    try {
      /*
       * En este orden y en la misma conexión, pero SIN una transacción que las envuelva: son tres
       * borrados independientes, y que uno falle no es razón para deshacer los otros dos. Que se
       * hayan barrido los enlaces vencidos sigue siendo cierto aunque los cupos den error.
       */
      const enlaces = await purgeExpiredLinks(client, opciones.clock);
      const cupos = await purgeOldBuckets(client, opciones.clock);
      const consumos = await purgeOldConsumptions(client, opciones.clock);
      return { enlaces, cupos, consumos };
    } finally {
      client.release();
    }
  }

  function pasada(): void {
    void barrer().then(
      ({ enlaces, cupos, consumos }) => {
        // Sólo se escribe cuando se borró algo: una línea por hora diciendo «cero» durante meses
        // entierra las que sí importan, y la ausencia de línea no es ambigua porque el arranque
        // siempre deja dicho que la tarea está encendida.
        if (enlaces + cupos + consumos > 0) {
          diario(
            `barridos: ${String(enlaces)} enlaces vencidos, ${String(cupos)} ventanas de cupo, ` +
              `${String(consumos)} registros de consumo`,
          );
        }
      },
      (fallo: unknown) => {
        // Un fallo acá no puede tumbar el servicio ni callarse. La siguiente vuelta lo reintenta:
        // lo que no se borró esta hora sigue vencido dentro de una.
        diario(`FALLÓ el barrido, se reintenta en la próxima vuelta: ${String(fallo)}`);
      },
    );
  }

  return {
    arrancar(): void {
      if (temporizador !== undefined) return;
      pasada();
      temporizador = setInterval(pasada, cadaMs);
      // `unref` para que un barrido pendiente no impida que el proceso termine cuando le toque.
      temporizador.unref();
      diario(`encendida: se barre al arrancar y cada ${String(cadaMs / 60_000)} min`);
    },
    detener(): void {
      if (temporizador === undefined) return;
      clearInterval(temporizador);
      temporizador = undefined;
    },
    barrer,
  };
}
