/**
 * El trabajador: quien de verdad reclama trabajos de la cola y los procesa.
 *
 * `cola.ts` es el puerto y su implementación sobre PostgreSQL; esto es el ritmo — el análogo, para
 * cualquier tipo de trabajo, de lo que `anchor/tarea.ts` es sólo para el anclaje. La forma
 * (`arrancar`/`detener`/`reposo`) es la misma a propósito: quien ya conoce un temporizador del
 * repositorio conoce éste.
 *
 * ═══ Por qué un trabajador genérico y no "mover el anclaje aquí dentro" ═══
 *
 * `anchor/tarea.ts` ya funciona, está probado y tiene dos ritmos deliberadamente distintos (uno sin
 * `poll` justo tras cortar, otro horario) que no son "un trabajo más" sino una decisión de dominio
 * del anclaje. Migrarlo pertenece a quien es dueño de ese fichero, no a este encargo — lo que este
 * módulo aporta es el mecanismo que cualquier tarea periódica *nueva* puede usar en vez de
 * reinventar su propio `setInterval`, y que además sobrevive a un reinicio del proceso porque el
 * trabajo pendiente queda en PostgreSQL, no en memoria.
 *
 * ═══ Reintentos ═══
 *
 * La política de backoff por defecto es exponencial con techo: `2^intentos` segundos, tope 5
 * minutos. Es un parámetro (`calcularReintento`), no una constante — quien registra un manejador con
 * necesidades distintas (reintentar un correo en minutos, no segundos) pasa la suya.
 */

import { type ColaDeTrabajos, type OpcionesDeReclamo, type TrabajoReclamado } from './cola.js';

export type DiarioDeTrabajos = (linea: string) => void;

export const DIARIO_A_STDERR: DiarioDeTrabajos = (linea) => {
  process.stderr.write(`[trabajos] ${linea}\n`);
};

/** Un manejador procesa un trabajo o lanza. Lanzar es la única señal de fallo que entiende la cola. */
export type ManejadorDeTrabajo = (trabajo: TrabajoReclamado) => Promise<void>;

/**
 * Cuánto esperar antes del siguiente intento, dado cuántos ya se hicieron (1 = el que acaba de
 * fallar). `undefined` significa "no reintentar": el trabajo queda `fallido` aunque le quedaran
 * intentos — para errores que un reintento no va a arreglar nunca (p.ej. datos inválidos).
 */
export type PoliticaDeReintento = (intentos: number, ahoraMs: number) => number | undefined;

export const REINTENTO_EXPONENCIAL_TOPE_5MIN: PoliticaDeReintento = (intentos, ahoraMs) => {
  const esperaMs = Math.min(2 ** intentos * 1000, 5 * 60_000);
  return ahoraMs + esperaMs;
};

export interface OpcionesDelTrabajador {
  readonly cola: ColaDeTrabajos;
  /** Instante actual en RFC 3339 UTC. Entra como puerto, igual que en `anchor/tarea.ts`. */
  readonly ahora: () => string;
  readonly manejadores: Readonly<Record<string, ManejadorDeTrabajo>>;
  readonly diario?: DiarioDeTrabajos;
  readonly intervaloMs?: number;
  readonly trabajadorId?: string;
  readonly loteMaximo?: number;
  readonly reintento?: PoliticaDeReintento;
  /**
   * Un trabajo `en_curso` más viejo que esto (desde `locked_at`) se considera abandonado — el
   * proceso que lo tomó probablemente murió a mitad de camino — y se libera para que otro lo
   * retome. Debe ser mayor que el tiempo máximo razonable de cualquier manejador registrado.
   */
  readonly tiempoMaximoDeBloqueoMs?: number;
}

export interface ResultadoDeCiclo {
  readonly reclamados: number;
  readonly completados: number;
  readonly fallidos: number;
  readonly liberados: number;
}

export interface TrabajadorDeTrabajos {
  /** Enciende el temporizador. Idempotente: llamarlo dos veces no duplica el intervalo. */
  arrancar(): void;
  /** Apaga el temporizador. Un ciclo en vuelo termina; no se corta a medias. */
  detener(): void;
  /**
   * Un ciclo inmediato: libera expirados, reclama un lote, procesa cada uno. Para pruebas y cron.
   * Si el ciclo entero revienta (p.ej. la base no responde), se registra en `diario` y devuelve
   * `undefined` — el mismo contrato que `tras()` en `anchor/tarea.ts`: un error de infraestructura
   * no debe tirar abajo a quien orquesta el trabajador, sólo quedar escrito.
   */
  cicloUnaVez(): Promise<ResultadoDeCiclo | undefined>;
  /** Espera a que termine lo que haya en cola. Para las pruebas y para un apagado ordenado. */
  reposo(): Promise<void>;
}

let contador = 0;

export function crearTrabajadorDeTrabajos(opciones: OpcionesDelTrabajador): TrabajadorDeTrabajos {
  const { cola, ahora, manejadores } = opciones;
  const diario = opciones.diario ?? DIARIO_A_STDERR;
  const reintento = opciones.reintento ?? REINTENTO_EXPONENCIAL_TOPE_5MIN;
  const tiempoMaximoDeBloqueoMs = opciones.tiempoMaximoDeBloqueoMs ?? 5 * 60_000;
  const trabajadorId =
    opciones.trabajadorId ?? `trabajador-${String(process.pid)}-${String(contador++)}`;
  const tipos = Object.keys(manejadores);

  let temporizador: NodeJS.Timeout | undefined;
  let enCurso: Promise<void> = Promise.resolve();

  const enCola = (trabajo: () => Promise<unknown>): Promise<void> => {
    const siguiente = async (): Promise<void> => {
      try {
        await trabajo();
      } catch (error) {
        diario(`el ciclo falló entero: ${describir(error)}`);
      }
    };
    enCurso = enCurso.then(siguiente, siguiente);
    return enCurso;
  };

  async function procesar(trabajo: TrabajoReclamado): Promise<'completado' | 'fallido'> {
    const manejador = manejadores[trabajo.tipo];
    if (manejador === undefined) {
      // No debería ocurrir: `reclamar` sólo pide los tipos registrados. Si ocurre de todos modos
      // (una carrera con otro proceso que registra menos manejadores), no se reintenta a ciegas:
      // se marca fallido en firme y queda escrito en `last_error` por qué.
      await cola.fallar(trabajo.id, {
        error: `sin manejador para el tipo '${trabajo.tipo}'`,
        ahora: ahora(),
      });
      diario(`trabajo ${trabajo.id} (${trabajo.tipo}): sin manejador registrado — fallido`);
      return 'fallido';
    }
    try {
      await manejador(trabajo);
      await cola.completar(trabajo.id, ahora());
      return 'completado';
    } catch (error) {
      const intentos = trabajo.intentos + 1;
      const reintentarEnMs =
        intentos < trabajo.intentosMaximos ? reintento(intentos, Date.parse(ahora())) : undefined;
      await cola.fallar(trabajo.id, {
        error: describir(error),
        ahora: ahora(),
        ...(reintentarEnMs === undefined
          ? {}
          : { reintentarEn: new Date(reintentarEnMs).toISOString() }),
      });
      diario(
        `trabajo ${trabajo.id} (${trabajo.tipo}): intento ${String(intentos)}/` +
          `${String(trabajo.intentosMaximos)} falló: ${describir(error)}`,
      );
      return 'fallido';
    }
  }

  async function ejecutarCiclo(): Promise<ResultadoDeCiclo> {
    const instante = ahora();
    const limiteDeBloqueo = new Date(Date.parse(instante) - tiempoMaximoDeBloqueoMs).toISOString();
    const liberados = await cola.liberarExpirados(limiteDeBloqueo, instante);
    if (liberados.length > 0) {
      diario(
        `${String(liberados.length)} trabajo(s) abandonado(s) liberado(s) de vuelta a pendiente`,
      );
    }

    if (tipos.length === 0) {
      return { reclamados: 0, completados: 0, fallidos: 0, liberados: liberados.length };
    }

    const opcionesDeReclamo: OpcionesDeReclamo = {
      trabajador: trabajadorId,
      ahora: instante,
      tipos,
      ...(opciones.loteMaximo === undefined ? {} : { maximo: opciones.loteMaximo }),
    };
    const reclamados = await cola.reclamar(opcionesDeReclamo);

    let completados = 0;
    let fallidos = 0;
    for (const trabajo of reclamados) {
      const resultado = await procesar(trabajo);
      if (resultado === 'completado') completados++;
      else fallidos++;
    }

    return { reclamados: reclamados.length, completados, fallidos, liberados: liberados.length };
  }

  return {
    arrancar(): void {
      if (temporizador !== undefined) return;
      const intervaloMs = opciones.intervaloMs ?? 5_000;
      temporizador = setInterval(() => {
        void enCola(ejecutarCiclo);
      }, intervaloMs);
      temporizador.unref();
      diario(
        `encendido: ${String(tipos.length)} tipo(s) de trabajo, cada ${String(intervaloMs)} ms, ` +
          `bloqueo abandonado tras ${String(tiempoMaximoDeBloqueoMs)} ms`,
      );
    },

    detener(): void {
      if (temporizador === undefined) return;
      clearInterval(temporizador);
      temporizador = undefined;
    },

    async cicloUnaVez(): Promise<ResultadoDeCiclo | undefined> {
      let resultado: ResultadoDeCiclo | undefined;
      await enCola(async () => {
        resultado = await ejecutarCiclo();
      });
      return resultado;
    },

    reposo: () => enCurso,
  };
}

function describir(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
