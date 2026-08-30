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
 * corto, cuando no. React no necesita el fotograma para haber repintado —su planificador usa
 * `MessageChannel`, que corre igual con la pestaña escondida—, así que a los 120 ms el DOM ya está
 * actualizado en los dos casos.
 *
 * Se descubrió midiendo: la prueba de «aceptar una tarea» fallaba en Firefox sólo dentro de la
 * corrida completa, con el elemento resuelto y sin foco durante los diez segundos enteros. No era
 * lentitud —diez segundos sobran—: era que el fotograma no llegaba nunca.
 *
 * ═══ El fallo simétrico, y por qué esta función recibe DÓNDE y no QUÉ hacer ═══
 *
 * El primer arreglo se cerraba con un cerrojo: la primera de las dos llamadas que corriera hacía el
 * trabajo y la segunda no hacía nada. Eso abrió el fallo contrario, que costó encontrar porque sólo
 * asoma de vez en cuando: si el fotograma llega **antes** de que React haya confirmado el
 * repintado, el elemento todavía no está en el documento, `getElementById` devuelve `null`, el
 * cerrojo queda echado **igual** — y el plazo de 120 ms, que habría funcionado, ya no hace nada.
 * Foco perdido, en silencio, otra vez.
 *
 * Se vio en `07-seguimiento-adr45`: abrir una evidencia privada dejaba su contenido sin foco. La
 * prueba pasaba 5 de 5 en una corrida y fallaba en la siguiente, con el elemento presente —resuelto
 * 23 veces— y «inactive» los diez segundos.
 *
 * Por eso ahora recibe **dónde** enfocar y no **qué hacer**: quien llama devuelve el elemento —o
 * `null` si todavía no existe— y esta función decide. Así puede distinguir «ya está hecho» de «no
 * había nada que enfocar», que con una acción opaca era imposible, y sólo se da por satisfecha
 * cuando de verdad enfocó algo. Si el fotograma llega temprano, el plazo lo reintenta; si el
 * fotograma no llega, el plazo lo hace igual. Los dos fallos, cerrados.
 */

/** Cuánto se espera al fotograma antes de enfocar igual. Ver el porqué del número arriba. */
const PLAZO_SIN_FOTOGRAMA_MS = 120;

/**
 * Enfoca lo que `buscar` devuelva, en cuanto React haya repintado — y también si el repintado no
 * llega.
 *
 * `buscar` se llama, como mucho, dos veces: en el fotograma y en el plazo. Devolver `null` o
 * `undefined` significa «todavía no existe», y entonces se reintenta. Se enfoca **una sola vez**:
 * en cuanto una de las dos encuentra su elemento, la otra ya no hace nada.
 */
export function enfocarTrasPintar(buscar: () => HTMLElement | null | undefined): void {
  if (typeof window === 'undefined') return;
  let hecho = false;
  const unaVez = (): void => {
    if (hecho) return;
    const destino = buscar();
    // El cerrojo se echa SÓLO si había algo que enfocar. Ésta es la línea entera del arreglo: con
    // `hecho = true` incondicional, un fotograma que llega antes que el repintado se comía el
    // reintento y el foco no se movía nunca.
    if (destino === null || destino === undefined) return;
    hecho = true;
    destino.focus();
  };
  window.requestAnimationFrame(unaVez);
  setTimeout(unaVez, PLAZO_SIN_FOTOGRAMA_MS);
}
