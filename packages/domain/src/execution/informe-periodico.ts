/**
 * El informe periódico que bloquea el avance de estado de la iniciativa (PRODUCT.md §3 y §6): un
 * hueco verificado como inexistente por `docs/OBJETIVO.md` («grep vacío en `execution` y
 * `app.ts`») antes de este encargo.
 *
 * ═══ Qué pide el pliego, con sus mismas palabras ═══
 *
 * PRODUCT.md §3: «**Seguimiento.** Informe cada 15 días; sin él la iniciativa no avanza de estado.»
 * PRODUCT.md §4, fila «Iniciativas», columna Errores: «Informe vencido: no avanza y entra al tablero
 * de deuda, atribuida al **círculo**, nunca a una persona.»
 *
 * Es el mismo tipo de compuerta que `execution/dependencias.ts` ya modela para el borrador de
 * dependencias y que `execution/escalones.ts` modela para el reloj de UNA tarea: una regla de avance
 * que el motor debe poder EVALUAR antes de aceptar una transición, no una casilla de formulario.
 *
 * ═══ Por qué esto es dominio puro y qué le falta a la integración ═══
 *
 * Pura: nada de reloj propio (`ahora` entra como parámetro, igual que `calcularEscalonDeTarea`), sin
 * I/O, sin aleatoriedad. El mismo par `(estado, ahora)` siempre produce el mismo veredicto.
 *
 * `InitiativeState` (`workspace/initiative.ts`, fuera de mi ámbito de escritura en este encargo) no
 * tiene todavía ni un evento `InitiativeStatusReportFiled` ni un campo que acumule los informes
 * rendidos: por eso `EstadoDeInformesDeIniciativa` de aquí abajo es una interfaz aparte, con lo
 * mínimo que la regla necesita (`activadaEn` e `informes`), para que quien integre pueda construirla
 * desde el agregado real el día que ese evento exista — igual que `EntradaEscalonDeTarea` no lee
 * `InitiativeTask` directamente, sino una forma reducida que cualquier lector puede producir. Hasta
 * entonces, `informes: []` es una entrada perfectamente válida: significa «todavía no se rindió
 * ninguno», que es exactamente el estado de cualquier iniciativa hoy, y el resultado —vencido a los
 * 15 días de activada, y sin recuperación posible sin persistencia— es la verdad honesta del sistema
 * actual, no un defecto de este módulo.
 *
 * ═══ Por qué la ventana corre desde la ratificación, no desde la creación ═══
 *
 * ADR-0044 fija `activatedAt` como el único portón de salida de `por-empezar`: antes de ratificada,
 * una iniciativa provisional «no admite hitos ni tareas» (`packages/contracts/src/iniciativas.ts`),
 * así que no hay nada que informar todavía. El primer plazo de 15 días corre desde ese instante, no
 * desde `createdAt` (que puede ser semanas antes, mientras corre la ventana de impugnación del
 * resultado).
 */

import { PreconditionError } from '../errors.js';
import { instant as toInstant, type Instant } from '../ids.js';
import { HORA_MS } from './escalones.js';

/** Un día, en milisegundos. Construida sobre `HORA_MS` para no repetir la constante de base. */
export const DIA_MS = 24 * HORA_MS;

/** PRODUCT.md §3, literal: «Informe cada 15 días». */
export const INTERVALO_INFORME_DIAS = 15;

/** El mismo intervalo, en milisegundos — lo que de verdad compara `informeVencido`. */
export const INTERVALO_INFORME_MS = INTERVALO_INFORME_DIAS * DIA_MS;

/**
 * Un informe ya rendido. Deliberadamente el único dato es el instante: el pliego no exige un texto
 * mínimo para que el informe cuente (a diferencia de la evidencia de una tarea, que si es pública
 * queda descrita en detalle) — sólo que exista, radicado a tiempo. Un campo `resumen` opcional se
 * deja fuera a propósito: añadirlo sin que el pliego lo pida sería inventar forma donde no la hay,
 * el mismo criterio que ya aplicó `execution/recursos-y-riesgos.ts` en su cabecera.
 */
export interface InformeDeSeguimiento {
  readonly rendidoEn: Instant;
}

/**
 * Lo mínimo que hace falta para juzgar si una iniciativa puede avanzar de estado. Ver la cabecera
 * para por qué no es, todavía, un campo literal de `InitiativeState`.
 */
export interface EstadoDeInformesDeIniciativa {
  /** El instante de `InitiativeActivated` (ADR-0044): desde aquí corre el primer plazo. */
  readonly activadaEn: Instant;
  /** Todos los informes rendidos hasta ahora, en cualquier orden — esta función no asume orden. */
  readonly informes: readonly InformeDeSeguimiento[];
}

function assertEstado(estado: EstadoDeInformesDeIniciativa): void {
  toInstant(estado.activadaEn);
  for (const informe of estado.informes) toInstant(informe.rendidoEn);
}

/**
 * El más reciente de los informes rendidos, o `undefined` si nunca se rindió ninguno. No asume que
 * `estado.informes` venga ordenado: toma el máximo, no el último elemento.
 */
function ultimoInforme(estado: EstadoDeInformesDeIniciativa): Instant | undefined {
  let max: Instant | undefined;
  for (const informe of estado.informes) {
    if (max === undefined || informe.rendidoEn > max) max = informe.rendidoEn;
  }
  return max;
}

/**
 * El instante en que vence el PRÓXIMO informe exigible: 15 días después del último rendido, o 15
 * días después de la activación si todavía no se rindió ninguno.
 */
export function proximoInformeVenceEn(estado: EstadoDeInformesDeIniciativa): Instant {
  assertEstado(estado);
  const base = ultimoInforme(estado) ?? estado.activadaEn;
  return toInstant(base + INTERVALO_INFORME_MS);
}

/**
 * `true` si a `ahora` el informe periódico está vencido — igual de inclusivo en el borde que
 * `calcularEscalonDeTarea` (`ahora >= venceEn` cuenta como vencido, no sólo `ahora > venceEn`).
 */
export function informeVencido(estado: EstadoDeInformesDeIniciativa, ahora: Instant): boolean {
  assertEstado(estado);
  toInstant(ahora);
  return ahora >= proximoInformeVenceEn(estado);
}

/**
 * Cuánto tiempo lleva vencido el informe, en milisegundos — la «antigüedad» que
 * `docs/research/03-deliberativa-sistemas-antipatrones.md` pide para el tablero de deuda («número y
 * antigüedad mediana de iniciativas vencidas sin informe»). `undefined` si no está vencido: cero no
 * sirve, porque cero es un valor válido de antigüedad el instante mismo en que vence.
 */
export function edadDelInformeVencidoMs(
  estado: EstadoDeInformesDeIniciativa,
  ahora: Instant,
): number | undefined {
  if (!informeVencido(estado, ahora)) return undefined;
  return ahora - proximoInformeVenceEn(estado);
}

/**
 * `true` si la iniciativa puede avanzar de estado a `ahora`: lo mismo que «no informeVencido», con
 * nombre propio porque es la pregunta que de verdad hace la capa que decide una transición — igual
 * que `puedeSuspenderDominio` en `escalones.ts` responde con el nombre de la decisión, no con el de
 * su condición interna.
 */
export function puedeAvanzarDeEstado(
  estado: EstadoDeInformesDeIniciativa,
  ahora: Instant,
): boolean {
  return !informeVencido(estado, ahora);
}

/**
 * La misma pregunta que `puedeAvanzarDeEstado`, pero fallando cerrado con un `PreconditionError`
 * — para quien de verdad está a punto de aplicar una transición y necesita que la compuerta
 * rechace la operación, no que la interfaz decida qué hacer con un booleano. PRODUCT.md atribuye el
 * vencimiento al **círculo**, nunca a una persona: por eso el mensaje no menciona a quien intenta la
 * transición.
 */
export function assertPuedeAvanzarDeEstado(
  estado: EstadoDeInformesDeIniciativa,
  ahora: Instant,
): void {
  if (!puedeAvanzarDeEstado(estado, ahora)) {
    throw new PreconditionError(
      'INFORME_PERIODICO_VENCIDO',
      'la iniciativa no avanza de estado: el informe periódico de seguimiento está vencido (PRODUCT.md §3)',
    );
  }
}
