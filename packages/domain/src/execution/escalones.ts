/**
 * El flujo de incumplimiento del pliego (ADR-0040): atraso → aviso → bloqueo → ayuda → reasignación
 * → revisión colectiva — y su excepción, jamás automática.
 *
 * ═══ Por qué esto es puro y de dónde salen los datos que le faltan ═══
 *
 * ADR-0040 fija la escalera con estas mismas palabras: `por-vencer` → `atrasada` → `consultada` →
 * `bloqueada` → `en-apoyo` → `reasignada` → `en-revision-colectiva` → `dominio-suspendido`. Los
 * nombres no son una invención de este fichero: son los mismos siete peldaños que
 * `packages/domain/src/evaluation/types.ts` (`ESCALATION_RUNGS`) ya usa para los dos que una
 * EVALUACIÓN puede pulsar después de cerrada la iniciativa. Este módulo cubre el otro uso: la tarea
 * VIVA, mientras se está ejecutando, y calcula todos los peldaños salvo el octavo.
 *
 * Cuatro de los siete estados de tarea (`bloqueada`, `en-apoyo`, `reasignacion-solicitada`,
 * `rechazada`) ya existen en `workspace/initiative.ts` con sus propios eventos, y ADR-0045 exige que
 * sólo quien aceptó la oferta los dispare — no es este módulo quien decide bloquear ni pedir ayuda,
 * sólo LEE el estado ya escrito y lo traduce a un peldaño con sus mismas palabras. Lo que faltaba y
 * es dominio nuevo: el peldaño 0 y el 1 (derivados de comparar `dueAt` con el instante, que entra
 * como parámetro — nunca `Date.now()`), el peldaño 2 (72 h de atraso, la misma comparación con otra
 * ventana) y la parte del 6 que ningún evento cubre todavía: «3 reasignaciones, o patrón en el
 * círculo». Las reasignaciones se cuentan de los propios registros de oferta de la tarea; el patrón
 * en el círculo es, por definición, una lectura a través de VARIAS tareas (y por tanto de otro
 * agregado), así que esta función la recibe como una señal ya calculada por quien llama — igual que
 * `patronEnElCirculo` en `EntradaEscalonDeTarea` — y no la computa por sí misma: hacerlo aquí
 * convertiría a este módulo en un lector de otros agregados, que es exactamente lo que ADR-0001
 * prohíbe.
 *
 * ═══ Por qué `dominio-suspendido` no es un valor de `EscalonTarea` ═══
 *
 * El propio ADR lo dice con las palabras que motivan esta separación: «excepcional, nunca
 * automático, con consentimiento del círculo, apelable». Un `calcularEscalonDeTarea` que pudiera
 * devolverlo sería, literalmente, la sanción automática que el ADR prohíbe. Por eso vive aparte,
 * como `DOMINIO_SUSPENDIDO`, alcanzable sólo a través de `puedeSuspenderDominio`, que exige un
 * consentimiento explícito como dato de entrada — nunca lo infiere del tiempo ni del estado.
 * `packages/domain/src/evaluation/commands.ts` tomó la misma decisión para el vocabulario que puede
 * pulsar una evaluación (`ESCALATION_RUNGS` deliberadamente NO incluye `dominio-suspendido`); este
 * fichero es la otra mitad de esa misma regla, para la tarea viva.
 *
 * ═══ Lo que impide la deriva punitiva (ADR-0039/ADR-0040) ═══
 *
 * Cada función de aquí recibe y devuelve datos sobre UNA tarea (o, para el patrón de círculo, un
 * conteo ya agregado que quien llama debe construir sin nombres). Nada en este módulo acepta ni
 * produce un identificador de persona, y no hay ninguna función que compare tareas entre sí para
 * ordenar a quien las tiene: eso es exactamente lo que ADR-0040 prohíbe como «panel de actividad por
 * persona», y el motivo por el que `EntradaEscalonDeTarea` ni siquiera tiene un campo `memberId`.
 */

import { PreconditionError } from '../errors.js';
import { type Instant, instant as toInstant } from '../ids.js';
import type { TaskStatus } from '../workspace/initiative.js';

/** Una hora, en milisegundos. Ninguna otra constante de este fichero se expresa de otro modo. */
export const HORA_MS = 60 * 60 * 1000;

/** Peldaño 0: aviso privado 48 h antes del vencimiento (PRODUCT.md §6, fila 0). No es sanción. */
export const VENTANA_POR_VENCER_MS = 48 * HORA_MS;

/** Peldaño 2: la pregunta «¿sigo? / ¿necesito ayuda? / no puedo» llega a las 72 h de atraso. */
export const VENTANA_CONSULTA_MS = 72 * HORA_MS;

/** Peldaño 6: «tras 3 reasignaciones» (PRODUCT.md §6, fila 6) — el tercer regreso al círculo. */
export const UMBRAL_REASIGNACIONES_PARA_REVISION_COLECTIVA = 3;

/**
 * Los siete peldaños que esta función puede devolver, en el mismo orden y con las mismas palabras
 * que ADR-0040 y `ESCALATION_RUNGS` (evaluation/types.ts). El octavo, `dominio-suspendido`, no está
 * aquí a propósito: ver la cabecera de este fichero.
 */
export const ESCALONES_DE_TAREA = [
  'por-vencer',
  'atrasada',
  'consultada',
  'bloqueada',
  'en-apoyo',
  'reasignada',
  'en-revision-colectiva',
] as const;
export type EscalonTarea = (typeof ESCALONES_DE_TAREA)[number];

/**
 * El octavo peldaño. Deliberadamente NO es un `EscalonTarea`: no lo devuelve ninguna función de
 * cálculo de este fichero, sólo aparece como resultado posible de `puedeSuspenderDominio`.
 */
export const DOMINIO_SUSPENDIDO = 'dominio-suspendido';
export type DominioSuspendido = typeof DOMINIO_SUSPENDIDO;

/**
 * Los estados de `TaskStatus` (workspace/initiative.ts) que ya representan, uno a uno, un peldaño
 * de la escalera. `rechazada` y `reasignacion-solicitada` comparten `reasignada`: las dos son «la
 * tarea volvió al círculo sin que nadie la tenga asignada», que es la definición del peldaño 5.
 */
const ESTADO_A_ESCALON: Readonly<Partial<Record<TaskStatus, EscalonTarea>>> = {
  bloqueada: 'bloqueada',
  'en-apoyo': 'en-apoyo',
  rechazada: 'reasignada',
  'reasignacion-solicitada': 'reasignada',
};

/** Estados en los que la tarea sigue en manos de quien la aceptó: ahí sí corre el reloj del plazo. */
const ESTADOS_CON_RELOJ_ACTIVO: ReadonlySet<TaskStatus> = new Set(['aceptada', 'en-curso']);

/**
 * Lo mínimo que hace falta para ubicar UNA tarea en la escalera. Nunca un identificador de persona
 * (ver la cabecera): quien construye esta entrada puede tenerlo para otra cosa, pero esta función no
 * lo pide ni lo usa.
 */
export interface EntradaEscalonDeTarea {
  readonly status: TaskStatus;
  readonly dueAt: Instant;
  /** Cuántas veces esta tarea volvió al círculo sin resolver — `TaskOffered` más cada `TaskReoffered`
   *  cuentan como 1, así que es `ofertas.length - 1`. Cero en la primera oferta, nunca antes. */
  readonly reasignaciones: number;
  /** Señal YA agregada por quien llama (ver cabecera): nunca la calcula esta función. */
  readonly patronEnElCirculo?: boolean;
}

function assertReasignaciones(valor: number): void {
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new PreconditionError(
      'ESCALON_REASIGNACIONES_INVALIDAS',
      'el conteo de reasignaciones debe ser un entero no negativo',
    );
  }
}

/** Sólo el tramo por tiempo: peldaños 0, 1 y 2, o ninguno si todavía falta más de 48 h. */
function escalonPorTiempo(dueAt: Instant, ahora: Instant): EscalonTarea | undefined {
  if (ahora < dueAt - VENTANA_POR_VENCER_MS) return undefined;
  if (ahora < dueAt) return 'por-vencer';
  if (ahora < dueAt + VENTANA_CONSULTA_MS) return 'atrasada';
  return 'consultada';
}

/**
 * El peldaño vigente de una tarea, o `undefined` si no hay ningún incumplimiento que señalar.
 *
 * Pura: sin I/O, sin reloj propio — `ahora` entra como parámetro (regla 2 de este encargo). El
 * mismo par `(entrada, ahora)` siempre produce el mismo peldaño.
 *
 * ═══ Prioridad cuando varias condiciones coinciden ═══
 *
 * 1. `completada` gana siempre: una tarea ya entregada y aceptada no tiene incumplimiento que
 *    mostrar, sin importar cuántas veces se reasignó antes de llegar ahí.
 * 2. El patrón de círculo o las 3 reasignaciones ganan sobre cualquier otra cosa: `en-revision-
 *    colectiva` es el techo de la escalera («el objeto es el acuerdo o la carga, no la persona» —
 *    PRODUCT.md §6), y una vez que el colectivo tiene que mirarlo no tiene sentido que un estado más
 *    liviano lo tape.
 * 3. `en-apoyo` y `bloqueada` — ambos con el reloj detenido (ADR-0040: «si avisar castiga, nadie
 *    avisa») — pesan más que cualquier lectura de tiempo, porque el tiempo dejó de correr.
 * 4. `reasignada` (tarea devuelta al círculo, ver `ESTADO_A_ESCALON`).
 * 5. Con la tarea todavía en manos de quien la aceptó (`aceptada`/`en-curso`), el peldaño sale de
 *    comparar `dueAt` con `ahora`.
 * 6. Cualquier otro estado (`ofrecida`: nadie se comprometió todavía; `entregada`: ya se entregó y
 *    espera revisión, no atraso) no tiene peldaño: `undefined`.
 */
export function calcularEscalonDeTarea(
  entrada: EntradaEscalonDeTarea,
  ahora: Instant,
): EscalonTarea | undefined {
  toInstant(ahora);
  toInstant(entrada.dueAt);
  assertReasignaciones(entrada.reasignaciones);

  if (entrada.status === 'completada') return undefined;

  if (
    entrada.reasignaciones >= UMBRAL_REASIGNACIONES_PARA_REVISION_COLECTIVA ||
    entrada.patronEnElCirculo === true
  ) {
    return 'en-revision-colectiva';
  }

  const porEstado = ESTADO_A_ESCALON[entrada.status];
  if (porEstado !== undefined) return porEstado;

  if (ESTADOS_CON_RELOJ_ACTIVO.has(entrada.status)) {
    return escalonPorTiempo(entrada.dueAt, ahora);
  }

  return undefined;
}

/**
 * Lo que hace falta para que el peldaño excepcional sea siquiera pensable. No lo aplica — no hay
 * ningún evento de dominio que este fichero pueda emitir para `workspace/initiative.ts`, que no es
 * suyo — sólo dice si las precondiciones del ADR se cumplen.
 */
export interface SolicitudDeSuspensionDeDominio {
  /** El peldaño vigente de la tarea, calculado por `calcularEscalonDeTarea` con el mismo `ahora`. */
  readonly escalonActual: EscalonTarea | undefined;
  /** El círculo dio su consentimiento explícito. Sin este dato, nunca es `true`: nunca automático. */
  readonly consentimientoDelCirculo: boolean;
}

/**
 * `true` sólo si la tarea ya está en el techo de la escalera (`en-revision-colectiva`) Y el círculo
 * dio su consentimiento explícito. Ninguna combinación de tiempo, reasignaciones o patrón por sí
 * sola habilita el peldaño excepcional: eso es precisamente lo que ADR-0040 llama «nunca automático».
 */
export function puedeSuspenderDominio(solicitud: SolicitudDeSuspensionDeDominio): boolean {
  return solicitud.escalonActual === 'en-revision-colectiva' && solicitud.consentimientoDelCirculo;
}
