/**
 * El estado real de una iniciativa en el tablero de PRODUCT.md §4 — y por qué es un dato derivado.
 *
 * ═══ El hallazgo que motiva este fichero ═══
 *
 * `http.ts` define `estadoIniciativa = z.enum(['por-empezar'])`: un enum de un solo valor, escrito
 * como literal. No es un error de tipeo: `InitiativeState.status` (`packages/domain/src/workspace
 * /initiative.ts`) es también, hoy, el tipo literal `'por-empezar'`, y el reductor del agregado
 * nunca lo actualiza a otra cosa — se fija así en `InitiativeCreated` y se repite igual en
 * `InitiativeActivated`. El campo existe, pero no cuenta nada.
 *
 * PRODUCT.md §4 promete un Kanban de **cinco** columnas: `por empezar`, `en curso`, `bloqueada`,
 * `en revisión`, `cerrada`. La pregunta que este fichero contesta, con evidencia y no por intuición,
 * es: ¿el dominio ya sabe distinguir esas columnas?
 *
 * ═══ Lo que el dominio sí sostiene (tres columnas, no cinco) ═══
 *
 * - **`por-empezar`**: `InitiativeState.activatedAt === undefined`. ADR-0043 lo dice en su propia
 *   letra — «la iniciativa nace en por-empezar»— y ADR-0044 hace de la ratificación (que fija
 *   `activatedAt` vía `InitiativeActivated`) el único portón de salida de ese estado. Antes de esa
 *   activación una iniciativa provisional «no admite hitos ni tareas»: no hay nada que mirar para
 *   distinguir columnas más finas, así que un único valor es exacto, no una simplificación.
 * - **`bloqueada`**: al menos una tarea vigente tiene una pausa activa — `TaskBlocked` o
 *   `TaskHelpRequested` sin `TaskResumed` (estado de tarea `bloqueada` o `en-apoyo`). ADR-0044 dice
 *   de las dos, con esas palabras, que «detienen el reloj»; PRODUCT.md sólo reserva una columna para
 *   ambas, así que aquí se tratan como el mismo hecho a nivel de iniciativa aunque el dominio las
 *   distinga a nivel de tarea. Es una decisión de agregación, documentada por si una futura columna
 *   quisiera separarlas.
 * - **`en-revision`**: al menos una tarea vigente está `entregada` — `TaskDelivered` sin
 *   `TaskChangesRequested` ni `TaskReviewAccepted` todavía. Es literalmente «alguien entregó y falta
 *   que el responsable inicial revise», que es la definición de la columna.
 * - Sin ninguna de las dos condiciones anteriores, y ya activada: **`en-curso`**.
 *
 * ═══ Lo que el dominio NO sostiene todavía: `cerrada` ═══
 *
 * No existe ningún evento `InitiativeClosed`, `InitiativeCompleted` ni equivalente en
 * `InitiativePayload` (`packages/domain/src/workspace/initiative.ts`). ADR-0045 lo deja explícito:
 * «`completada` es terminal para esa tarea. No cierra automáticamente el hito ni la iniciativa». Que
 * todas las tareas de todos los hitos estén `completada` es una condición que se podría comprobar,
 * pero **inventar** una quinta columna a partir de esa comprobación sería exactamente lo que la
 * consigna de este encargo prohíbe: un estado que el dominio no afirma, porque ningún acto del
 * ledger dice «esta iniciativa cerró» — ni quién lo cerró, ni cuándo, ni con qué evaluación (ADR-0053
 * ya construyó ese cierre para decisiones y aprendizajes; iniciativas todavía no tiene su
 * equivalente). Cerrarla aquí, en la capa de presentación, sería fabricar un hecho de gobierno sin
 * que nadie lo haya declarado — el error inverso al que ADR-0026 previene para los resultados de
 * votación. Por eso `estadoTableroIniciativa` tiene **cuatro** valores, no cinco, y esa ausencia es
 * el hallazgo que este fichero entrega, no un defecto de esta implementación.
 *
 * ═══ Cómo se integra ═══
 *
 * Este fichero es nuevo y `packages/contracts/src/index.ts` todavía no lo reexporta (fuera de mi
 * ámbito: ver CLAUDE.md de este encargo). El presentador `iniciativaDto` de
 * `services/api/src/http/presenters.ts` sigue devolviendo el `estado: 'por-empezar'` fijo de
 * siempre; la integración pendiente es: 1) añadir `export * from './iniciativas.js'` a
 * `packages/contracts/src/index.ts`; 2) sustituir esa línea fija en `iniciativaDto` por
 * `derivarEstadoTableroIniciativa(state)`; 3) si `IniciativaResumen`/`IniciativaDetalle` deben
 * exponer el estado real en vez del histórico, ampliar `estadoIniciativa` en `http.ts` con estos
 * mismos cuatro valores. Mientras eso no ocurra, `GET /iniciativas/tablero`
 * (`services/api/src/http/rutas-iniciativas.ts`) ya sirve el estado correcto sin tocar ninguno de
 * esos ficheros compartidos.
 */

import { z } from 'zod';

import type { InitiativeState, TaskStatus } from '@koinonia/domain';

/**
 * Los cuatro estados que el dominio puede demostrar hoy. Ver la cabecera de este fichero para la
 * evidencia de cada uno y para por qué no hay un quinto (`cerrada`).
 */
export const estadoTableroIniciativa = z.enum([
  'por-empezar',
  'en-curso',
  'bloqueada',
  'en-revision',
]);
export type EstadoTableroIniciativa = z.infer<typeof estadoTableroIniciativa>;

/** Cómo se dice cada estado en pantalla. Una sola tabla, igual que `ESTADO_PROBLEMA_EN_PALABRAS`. */
export const ESTADO_TABLERO_INICIATIVA_EN_PALABRAS: Readonly<
  Record<EstadoTableroIniciativa, string>
> = {
  'por-empezar': 'Por empezar',
  'en-curso': 'En curso',
  bloqueada: 'Bloqueada',
  'en-revision': 'En revisión',
};

/** Estados de tarea que detienen su reloj (ADR-0044); a nivel de iniciativa pintan «bloqueada». */
const TASK_STATUSES_QUE_BLOQUEAN: ReadonlySet<TaskStatus> = new Set(['bloqueada', 'en-apoyo']);

/**
 * Deriva el estado del tablero desde el agregado de iniciativa. Pura: sin I/O, sin reloj propio.
 *
 * Prioridad cuando coexisten condiciones (por ejemplo una tarea bloqueada y otra entregada a la
 * vez): `bloqueada` antes que `en-revision`, porque una iniciativa detenida necesita desbloquearse
 * antes de que una revisión pendiente tenga sentido — revisar una entrega no la destraba.
 */
export function derivarEstadoTableroIniciativa(state: InitiativeState): EstadoTableroIniciativa {
  if (state.activatedAt === undefined) return 'por-empezar';
  if (state.tasks.some((task) => TASK_STATUSES_QUE_BLOQUEAN.has(task.status))) return 'bloqueada';
  if (state.tasks.some((task) => task.status === 'entregada')) return 'en-revision';
  return 'en-curso';
}

/**
 * El avance en bruto: cuántos hitos y cuántas tareas hay, y cuántas de esas tareas ya cerraron.
 *
 * Es un conteo del **colectivo de trabajo de la iniciativa**, nunca de una persona — no hay aquí
 * ningún «quién hizo cuánto» (ADR-0039, ADR-0040). `tareasCompletas`/`tareasTotales` describen la
 * iniciativa como un todo, igual que un contador de páginas describe un documento, no a quien
 * escribió cada página.
 */
export interface AvanceIniciativa {
  readonly hitos: number;
  readonly tareasTotales: number;
  readonly tareasCompletas: number;
}

export function derivarAvanceIniciativa(state: InitiativeState): AvanceIniciativa {
  return {
    hitos: state.milestones.length,
    tareasTotales: state.tasks.length,
    tareasCompletas: state.tasks.filter((task) => task.status === 'completada').length,
  };
}
