/**
 * Mover el foco después de que React repintó, sin depender de que llegue un fotograma.
 *
 * ═══ Qué problema resuelve ═══
 *
 * Trece sitios de la interfaz hacían `requestAnimationFrame(() => algo?.focus())`. La intención es
 * correcta y hace falta: el elemento que hay que enfocar —el aviso de resultado, la tarjeta que
 * acaba de cambiar de estado— **no existe todavía** cuando se llama a `setState`, así que enfocarlo
 * en el mismo turno no enfoca nada. Había que esperar al repintado.
 *
 * El problema es de qué se cuelga esa espera. `requestAnimationFrame` **no se ejecuta si no hay
 * fotograma**: una pestaña en segundo plano, una ventana tapada por otra, o un navegador con el
 * repintado limitado no lo llaman —ni tarde: **nunca**—. Y entonces el foco no se mueve, en
 * silencio, sin error en ninguna parte.
 *
 * Eso no es una molestia menor. Ese salto de foco **es** el aviso: para quien usa un lector de
 * pantalla, mover el foco al aviso de resultado es lo que le dice que su acción terminó y cómo
 * salió. Si no ocurre, la persona se queda sin enterarse de nada —justo la clase de fallo que no se
 * ve en una captura ni lo nota quien mira la pantalla—.
 *
 * ═══ Cómo lo resuelve ═══
 *
 * Se piden las dos cosas y gana la que llegue primero: el fotograma, cuando lo hay, y un plazo
 * corto, cuando no. La que pierde se cancela, así que el foco se mueve **una sola vez**. React no
 * necesita el fotograma para haber repintado —su planificador usa `MessageChannel`, que corre
 * igual con la pestaña escondida—, así que a los 120 ms el DOM ya está actualizado en los dos
 * casos.
 *
 * Se descubrió midiendo: la prueba de «aceptar una tarea» fallaba en Firefox sólo dentro de la
 * corrida completa, con el elemento resuelto y sin foco durante los diez segundos enteros. No era
 * lentitud —diez segundos sobran—: era que el fotograma no llegaba nunca.
 */

/** Cuánto se espera al fotograma antes de enfocar igual. Ver el porqué del número arriba. */
const PLAZO_SIN_FOTOGRAMA_MS = 120;

/**
 * Corre `mover` en cuanto React haya repintado — y también si el repintado no llega.
 *
 * Recibe la acción entera y no el elemento porque ese elemento puede no existir todavía en el
 * momento de la llamada, que es justamente el motivo de esperar. Se llama **una sola vez**.
 */
export function enfocarTrasPintar(mover: () => void): void {
  if (typeof window === 'undefined') return;
  let hecho = false;
  const unaVez = (): void => {
    // No se cancela la que pierde: con este cerrojo, la segunda llamada no hace nada. Cancelar
    // exigiría guardar dos identificadores para ahorrar una llamada vacía de 120 ms.
    if (hecho) return;
    hecho = true;
    mover();
  };
  window.requestAnimationFrame(unaVez);
  setTimeout(unaVez, PLAZO_SIN_FOTOGRAMA_MS);
}
