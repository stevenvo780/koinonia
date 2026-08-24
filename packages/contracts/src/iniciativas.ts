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

import {
  CATEGORIAS_RECURSO,
  MAX_DESCRIPCION_RECURSO_LENGTH,
  MAX_DESCRIPCION_RIESGO_LENGTH,
  MAX_MONTO_CENTAVOS,
  MAX_RECURSOS_POR_INICIATIVA,
  MAX_RIESGOS_POR_INICIATIVA,
  MAX_SOPORTE_DESCRIPCION_LENGTH,
  MAX_SOPORTE_FUENTE_LENGTH,
  MAX_SOPORTES,
  MIN_DESCRIPCION_RECURSO_LENGTH,
  MIN_DESCRIPCION_RIESGO_LENGTH,
  MIN_MONTO_CENTAVOS,
  MIN_SOPORTE_DESCRIPCION_LENGTH,
  MIN_SOPORTE_FUENTE_LENGTH,
  MIN_SOPORTES,
  MONEDA_PATTERN,
  SEVERIDADES_RIESGO,
  sortIds,
  type InitiativeState,
  type MemberId,
  type TaskStatus,
} from '@koinonia/domain';

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

/**
 * Quién forma el equipo de una iniciativa: los `MemberId` que en algún momento aceptaron al menos
 * una tarea (`assigneeId` sólo existe después de `TaskAccepted` — ver `InitiativeTask`). No es una
 * medida de actividad: es sólo membresía, la misma noción que PRODUCT.md §4 pide para el Kanban
 * («…con la decisión de origen enlazada, avance, próximo informe y **quién responde**»). Ordenado con
 * `sortIds` (orden de bytes, no `localeCompare`) para que la lista sea determinista entre servidores.
 */
export function derivarEquipoIniciativa(state: InitiativeState): readonly MemberId[] {
  const asignados = new Set<MemberId>();
  for (const task of state.tasks) {
    if (task.assigneeId !== undefined) asignados.add(task.assigneeId);
  }
  return sortIds([...asignados]);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Recursos, riesgos y presupuesto: los tres campos de la ficha que la auditoría del encargo B
// encontró sin modelar. Las reglas de negocio y los invariantes viven en
// `packages/domain/src/execution/{recursos-y-riesgos,presupuesto}.ts`; aquí sólo está la forma de
// frontera (Zod) que un formulario o una respuesta HTTP pueden usar para validar antes de llegar al
// dominio. Ningún nombre de campo cambia entre las dos capas a propósito: son el mismo dato dos veces
// descrito, nunca dos datos distintos con el mismo nombre.
//
// Igual que `estadoTableroIniciativa` más arriba, este bloque es nuevo y `index.ts` de este paquete
// todavía no lo reexporta (fuera de mi ámbito, ver CLAUDE.md de este encargo); tampoco hay todavía un
// evento de dominio en `workspace/initiative.ts` que persista estos tres campos en el ledger — eso es
// integración pendiente, no parte de este encargo.
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Espejo Zod de `CategoriaRecurso` (`execution/recursos-y-riesgos.ts`). */
export const categoriaRecurso = z.enum(CATEGORIAS_RECURSO);
export type CategoriaRecurso = z.infer<typeof categoriaRecurso>;

/** Cómo se dice cada categoría en pantalla. */
export const CATEGORIA_RECURSO_EN_PALABRAS: Readonly<Record<CategoriaRecurso, string>> = {
  economico: 'Económico',
  espacio: 'Espacio',
  'equipo-tecnico': 'Equipo técnico',
  'aval-institucional': 'Aval institucional',
  'tiempo-experto': 'Tiempo de una persona experta',
  otro: 'Otro',
};

/**
 * Un recurso que la iniciativa necesita y hoy no tiene. Nunca un inventario de lo que ya tiene: ver
 * la cabecera de `execution/recursos-y-riesgos.ts` para la razón completa.
 */
export const recursoNecesario = z.object({
  categoria: categoriaRecurso,
  descripcion: z.string().min(MIN_DESCRIPCION_RECURSO_LENGTH).max(MAX_DESCRIPCION_RECURSO_LENGTH),
});
export type RecursoNecesario = z.infer<typeof recursoNecesario>;

/** La lista completa de recursos faltantes de una iniciativa. Vacía es válida: no le falta nada. */
export const recursosNecesarios = z.array(recursoNecesario).max(MAX_RECURSOS_POR_INICIATIVA);

/** Espejo Zod de `SeveridadRiesgo`. Vocabulario cerrado: nunca una probabilidad numérica libre. */
export const severidadRiesgo = z.enum(SEVERIDADES_RIESGO);
export type SeveridadRiesgo = z.infer<typeof severidadRiesgo>;

export const SEVERIDAD_RIESGO_EN_PALABRAS: Readonly<Record<SeveridadRiesgo, string>> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
};

/** Un riesgo declarado sobre la iniciativa. Nunca sobre una persona (ADR-0039/ADR-0040). */
export const riesgoDeclarado = z.object({
  severidad: severidadRiesgo,
  descripcion: z.string().min(MIN_DESCRIPCION_RIESGO_LENGTH).max(MAX_DESCRIPCION_RIESGO_LENGTH),
});
export type RiesgoDeclarado = z.infer<typeof riesgoDeclarado>;

/** La lista completa de riesgos declarados. Vacía es válida: hoy no hay ninguno que señalar. */
export const riesgosDeclarados = z.array(riesgoDeclarado).max(MAX_RIESGOS_POR_INICIATIVA);

/** Un soporte del presupuesto: qué evidencia lo respalda y dónde encontrarla. */
export const soporte = z.object({
  descripcion: z.string().min(MIN_SOPORTE_DESCRIPCION_LENGTH).max(MAX_SOPORTE_DESCRIPCION_LENGTH),
  fuente: z.string().min(MIN_SOPORTE_FUENTE_LENGTH).max(MAX_SOPORTE_FUENTE_LENGTH),
});
export type Soporte = z.infer<typeof soporte>;

/**
 * El presupuesto de una iniciativa, **cuando aplica**. La condicionalidad se expresa con
 * `.optional()` — nunca `.nullable()` — a propósito: `undefined` desaparece de un JSON serializado,
 * `null` es una clave que sigue ahí con un valor centinela. Un formulario que no maneja dinero nunca
 * debe enviar `presupuesto: null`; simplemente omite la clave. Ver `execution/presupuesto.ts` para el
 * razonamiento completo, incluida la regla espejo del lado del dominio que rechaza `null` con su
 * propio código de error si algo, en algún borde, lo produjera de todos modos.
 */
export const presupuesto = z.object({
  montoCentavos: z.number().int().min(MIN_MONTO_CENTAVOS).max(MAX_MONTO_CENTAVOS),
  moneda: z.string().regex(MONEDA_PATTERN),
  soportes: z.array(soporte).min(MIN_SOPORTES).max(MAX_SOPORTES),
});
export type Presupuesto = z.infer<typeof presupuesto>;

/** El campo condicional tal como aparece embebido en una ficha: presente, o ausente — nunca `null`. */
export const presupuestoCondicional = presupuesto.optional();
