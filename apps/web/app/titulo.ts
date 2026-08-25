import type { Metadata } from 'next';

/**
 * El título de la pestaña, por pantalla.
 *
 * Hasta acá el único `metadata` del árbol era el del layout raíz, así que las treinta y dos
 * pantallas se llamaban «Koinonía» y nada más. Se ve al medirlo: `page.title()` devolvía la misma
 * cadena en las dieciséis rutas de la navegación. Eso rompe dos cosas distintas.
 *
 * La primera es de todos los días: quien tiene abierta una decisión, su resultado y la conversación
 * que la originó —que es exactamente cómo se usa esto en una asamblea— ve tres pestañas idénticas y
 * tiene que ir clic por clic para encontrar cuál es cuál. Lo mismo en el historial del navegador y
 * en un marcador guardado.
 *
 * La segunda es de accesibilidad, y es la que obliga: en una navegación del lado del cliente no hay
 * recarga de página, así que **el cambio de `document.title` es lo que le avisa a un lector de
 * pantalla que la ruta cambió** (WCAG 2.4.2). Con un título constante, alguien que navega a ciegas
 * pulsa un enlace y no recibe ninguna señal de haber llegado a otro lado.
 *
 * Va en una capa y no en la pantalla porque las treinta y dos `page.tsx` son componentes de cliente
 * —tienen estado, formularios y reloj— y Next.js sólo lee `metadata` de un componente de servidor.
 * La capa no pinta nada: existe para poner el nombre.
 */
export function tituloDe(nombre: string): Metadata {
  // Absoluto y no una plantilla en la raíz: la plantilla obligaría a tocar el layout raíz, y el
  // separador «·» se elige por ser el que menos ruido hace cuando el navegador recorta la pestaña.
  return { title: `${nombre} · Koinonía` };
}
