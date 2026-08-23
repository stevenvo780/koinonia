/**
 * La máquina de estados del borrador. Tres estados y una tabla, como todo lo demás del dominio.
 *
 * ═══ Por qué es tan corta, y por qué aun así existe ═══
 *
 * Un formulario no necesita fases: sería justo el «examen» que §3.1 quiere evitar. Lo que sí necesita
 * es que **cerrar sea un acto y no un estado que se alcanza solo**, y que después de cerrar nadie
 * pueda tocar lo escrito sin que se note. De ahí `cerrado`, que es absorbente.
 *
 * Que la tabla exista aunque tenga tres filas tiene un motivo concreto: la comprobación deja de
 * depender de que cada orden se acuerde de mirar el estado. `applyAssistant` la consulta **para todos
 * los eventos**, así que un evento fuera de sitio se rechaza también cuando llega por otro camino —una
 * restauración, un fichero traído de fuera— y no sólo cuando lo pide la API.
 *
 * ═══ Lo que aquí NO hay: reapertura ═══
 *
 * De `cerrado` no se sale. No es rigidez: un borrador cerrado ya produjo lo que tenía que producir —la
 * frase, los huecos, y de los huecos las tareas—, y reabrirlo cambiaría, en retrospectiva, el texto
 * que otras cosas ya citaron. Corregir después de cerrar es abrir otro borrador, que es lo mismo que
 * hace la constitución con sus versiones y por la misma razón: la anterior tiene que seguir existiendo
 * para poder comparar.
 */

import { IllegalTransitionError } from '../errors.js';
import type { AssistantEventType, EstadoBorrador } from './types.js';

export const ESTADOS_BORRADOR: readonly EstadoBorrador[] = ['inexistente', 'redactando', 'cerrado'];

export interface Transicion {
  readonly desde: EstadoBorrador;
  readonly evento: AssistantEventType;
  readonly hacia: EstadoBorrador;
}

/**
 * La tabla completa. Lo que no está aquí no ocurre.
 *
 * Los cuatro eventos de escritura —respuesta, sugerencia recibida, sugerencia aplicada y
 * consentimiento— dejan el borrador donde estaba: cambian su contenido, no su situación. Sólo abrir y
 * cerrar mueven el estado.
 */
export const TRANSICIONES: readonly Transicion[] = [
  { desde: 'inexistente', evento: 'BorradorAbierto', hacia: 'redactando' },
  { desde: 'redactando', evento: 'RespuestaEscrita', hacia: 'redactando' },
  { desde: 'redactando', evento: 'SugerenciaRecibida', hacia: 'redactando' },
  { desde: 'redactando', evento: 'SugerenciaAplicada', hacia: 'redactando' },
  { desde: 'redactando', evento: 'ConsentimientoDecidido', hacia: 'redactando' },
  { desde: 'redactando', evento: 'BorradorCerrado', hacia: 'cerrado' },
];

/** `cerrado` es absorbente: ningún evento sale de ahí. */
export const ESTADOS_TERMINALES: readonly EstadoBorrador[] = ['cerrado'];

export function esTerminal(estado: EstadoBorrador): boolean {
  return ESTADOS_TERMINALES.includes(estado);
}

export function esTransicionLegal(desde: EstadoBorrador, evento: AssistantEventType): boolean {
  return TRANSICIONES.some((t) => t.desde === desde && t.evento === evento);
}

/** Los eventos que caben en un estado, en el orden de la tabla. Sirve para la interfaz y para probar. */
export function eventosLegalesDesde(estado: EstadoBorrador): readonly AssistantEventType[] {
  return TRANSICIONES.filter((t) => t.desde === estado).map((t) => t.evento);
}

/**
 * El estado siguiente, o `IllegalTransitionError`.
 *
 * Falla cerrado (principio 0.1.5): ante un evento que no cabe, se rechaza. Nunca se «interpreta
 * caritativamente» que quien lo mandó quería otra cosa.
 */
export function siguienteEstado(desde: EstadoBorrador, evento: AssistantEventType): EstadoBorrador {
  const transicion = TRANSICIONES.find((t) => t.desde === desde && t.evento === evento);
  if (transicion === undefined) {
    throw new IllegalTransitionError(
      desde,
      evento,
      desde === 'cerrado'
        ? 'el borrador ya se cerró y no se reabre: lo que haya que corregir se escribe en otro'
        : 'no hay borrador todavía: el primer evento tiene que ser el que lo abre',
    );
  }
  return transicion.hacia;
}
