/**
 * El peldaño 7 del flujo de incumplimiento (ADR-0040, PRODUCT.md §6): «encargo retirado». La puerta
 * ya existe en `execution/escalones.ts` (`puedeSuspenderDominio`) desde una ronda anterior; este
 * fichero es lo que le faltaba, verificado contra el pliego palabra por palabra.
 *
 * ═══ Lo que ya estaba, y lo que faltaba ═══
 *
 * `escalones.ts` ya impide que el peldaño excepcional sea automático: `puedeSuspenderDominio` exige
 * `escalonActual === 'en-revision-colectiva'` (el techo de la escalera) Y `consentimientoDelCirculo`
 * explícito, y devuelve un booleano — nunca lo aplica, porque no hay evento de dominio en
 * `workspace/initiative.ts` (fuera de mi ámbito) que este fichero pueda emitir.
 *
 * Lo que ese booleano NO puede sostener es la otra mitad exacta del pliego: PRODUCT.md §6, fila 7,
 * columna «Quién lo ve» dice **«Público y motivado»**. Un booleano no es un motivo: no hay forma de
 * que un `true` diga POR QUÉ el círculo retiró un encargo, y sin ese porqué registrado, «público y
 * motivado» es sólo «público». Retirarle un encargo a alguien es, con las palabras del propio
 * encargo de esta sesión, «lo más duro que hace este sistema con una persona» — así que la ausencia
 * de un motivo exigible no es un detalle menor, es la mitad que faltaba de la garantía.
 *
 * Este módulo añade esa mitad: `registrarRetiroDeEncargo` no sólo verifica la misma puerta que
 * `puedeSuspenderDominio` (el techo de la escalera + el consentimiento), sino que exige un motivo de
 * verdad —no vacío, no un «sí» de tres letras— y, sólo si las tres condiciones se cumplen, produce
 * el HECHO registrable: el motivo tal como se guarda, y cuándo se decidió. `puedeSuspenderDominio`
 * queda intacto: no se toca `escalones.ts` para no arriesgar sus pruebas ya verdes, y porque las dos
 * funciones responden preguntas distintas (¿se puede? vs. ¿cuál es el registro que hay que guardar
 * si se hace?).
 *
 * ═══ Por qué no hay ranking ni identificador de persona aquí tampoco ═══
 *
 * Igual que `EntradaEscalonDeTarea` en `escalones.ts`, nada de aquí acepta ni produce un
 * identificador de persona: el motivo describe la carga o el acuerdo incumplido, nunca compara a
 * quien tenía el encargo con nadie más. Eso es lo que ADR-0040 llama «el objeto es el acuerdo o la
 * carga, no la persona», aplicado al peldaño más severo de los ocho.
 */

import { PreconditionError } from '../errors.js';
import { instant as toInstant, type Instant } from '../ids.js';
import { DOMINIO_SUSPENDIDO, type DominioSuspendido, type EscalonTarea } from './escalones.js';

/**
 * Un motivo de una sola palabra o vacío no es un motivo público: 20 caracteres es apenas más que
 * «se reasignó tres veces», el mínimo que fuerza a escribir una frase real en vez de una etiqueta.
 */
export const MIN_MOTIVO_RETIRO_LENGTH = 20;

/** Igual de generoso que el resto de los campos de texto libre del paquete (ver `presupuesto.ts`). */
export const MAX_MOTIVO_RETIRO_LENGTH = 2000;

/**
 * Lo que hace falta para siquiera considerar el peldaño excepcional. Mismos tres campos que exige
 * el pliego, uno a uno: el techo de la escalera, el consentimiento explícito y el motivo público.
 */
export interface SolicitudDeRetiroDeEncargo {
  /** El peldaño vigente de la tarea, calculado por `calcularEscalonDeTarea` con el mismo instante. */
  readonly escalonActual: EscalonTarea | undefined;
  /** El círculo dio su consentimiento explícito. Sin este dato, nunca es `true`: nunca automático. */
  readonly consentimientoDelCirculo: boolean;
  /** Por qué se retira el encargo. Público (PRODUCT.md §6): nunca queda vacío ni oculto. */
  readonly motivo: string;
}

/** Por qué se rechazó una solicitud de retiro — para que quien llama muestre algo útil. */
export type RechazoDeRetiroDeEncargo =
  | 'sin-techo-de-escalera'
  | 'sin-consentimiento-del-circulo'
  | 'sin-motivo'
  | 'motivo-demasiado-largo';

/**
 * El hecho ya registrable: el motivo (recortado de espacios en los bordes) y el instante en que el
 * círculo lo decidió. Deliberadamente sin `taskId` ni ningún identificador: quien construye este
 * registro ya sabe a qué tarea corresponde y lo asocia por fuera, igual que
 * `EntradaEscalonDeTarea` nunca lleva el suyo (ver la cabecera de `escalones.ts`).
 */
export interface RetiroDeEncargoRegistrado {
  readonly peldano: DominioSuspendido;
  readonly motivo: string;
  readonly decididoEn: Instant;
}

function motivoRechazo(
  solicitud: SolicitudDeRetiroDeEncargo,
): RechazoDeRetiroDeEncargo | undefined {
  if (solicitud.escalonActual !== 'en-revision-colectiva') return 'sin-techo-de-escalera';
  if (!solicitud.consentimientoDelCirculo) return 'sin-consentimiento-del-circulo';
  const motivo = solicitud.motivo.trim();
  if (motivo.length < MIN_MOTIVO_RETIRO_LENGTH) return 'sin-motivo';
  if (motivo.length > MAX_MOTIVO_RETIRO_LENGTH) return 'motivo-demasiado-largo';
  return undefined;
}

/**
 * La misma puerta que `puedeSuspenderDominio`, con el motivo como tercera condición. `true` sólo si
 * las tres —techo de la escalera, consentimiento explícito, motivo real— se cumplen a la vez.
 */
export function puedeRetirarEncargo(solicitud: SolicitudDeRetiroDeEncargo): boolean {
  return motivoRechazo(solicitud) === undefined;
}

/**
 * Por qué, si `puedeRetirarEncargo` es `false`, lo es — para una interfaz que necesita explicar el
 * rechazo en vez de sólo negarlo. `undefined` si de hecho se puede.
 */
export function porQueNoSePuedeRetirarEncargo(
  solicitud: SolicitudDeRetiroDeEncargo,
): RechazoDeRetiroDeEncargo | undefined {
  return motivoRechazo(solicitud);
}

/**
 * El registro del peldaño excepcional, o el rechazo con `PreconditionError` — nunca lo aplica (ver
 * la cabecera: no hay evento de `workspace/initiative.ts` que este módulo pueda emitir), sólo
 * produce el HECHO que quien integre necesita para escribirlo. Pura: `decididoEn` entra como
 * parámetro, nunca `Date.now()`.
 */
export function registrarRetiroDeEncargo(
  solicitud: SolicitudDeRetiroDeEncargo,
  decididoEn: Instant,
): RetiroDeEncargoRegistrado {
  toInstant(decididoEn);
  const rechazo = motivoRechazo(solicitud);
  if (rechazo !== undefined) {
    const mensajes: Readonly<Record<RechazoDeRetiroDeEncargo, string>> = {
      'sin-techo-de-escalera':
        'el encargo sólo puede retirarse desde el techo de la escalera (en-revision-colectiva)',
      'sin-consentimiento-del-circulo':
        'retirar un encargo exige el consentimiento explícito del círculo: nunca es automático',
      'sin-motivo': `el motivo del retiro debe tener al menos ${String(MIN_MOTIVO_RETIRO_LENGTH)} caracteres: público y motivado, no una etiqueta`,
      'motivo-demasiado-largo': `el motivo del retiro admite como máximo ${String(MAX_MOTIVO_RETIRO_LENGTH)} caracteres`,
    };
    throw new PreconditionError(
      `RETIRO_ENCARGO_${rechazo.toUpperCase().replaceAll('-', '_')}`,
      mensajes[rechazo],
    );
  }
  return { peldano: DOMINIO_SUSPENDIDO, motivo: solicitud.motivo.trim(), decididoEn };
}
