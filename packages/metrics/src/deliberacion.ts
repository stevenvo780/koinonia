/**
 * Métrica 5 — **razón deliberación/votación**, con la tasa de unanimidad.
 *
 * §6: «Mide si se delibera o sólo se cuenta, y si el disenso encuentra dónde expresarse o
 * simplemente se fue.»
 *
 * # La métrica más fácil de convertir en vigilancia, y la que menos lo es
 *
 * La versión ingenua contaría intervenciones por persona, y de ahí a un panel de participación hay
 * un paso. Aquí la entrada **no tiene personas**: una deliberación llega como «cuántas
 * intervenciones tuvo», un número. No hay nada que desglosar por individuo porque no hay
 * individuos, y eso no es una limitación que haya que documentar en una guía de estilo: es el tipo.
 *
 * # Una razón no es una proporción
 *
 * `deliberaciones / votaciones` puede pasar de 1 y debe poder pasar de 1: tres conversaciones por
 * cada votación es exactamente lo que se busca. Se publica como fracción exacta, sin normalizar a
 * porcentaje, porque un «300 %» en pantalla se lee como un error y no como tres.
 *
 * # Sin umbral inventado
 *
 * §6 fija un número para el cumplimiento (0,5) y otro para el reparto de la voz (0,15). Para ésta
 * **no da ninguno**, y aquí no se inventa. La unanimidad alta tampoco lleva alarma: no se puede
 * decidir por umbral si un 100 % de acuerdo significa que la comunidad coincide o que quien no
 * coincidía dejó de venir. Eso lo lee una asamblea mirando la serie, que es justamente lo que §6
 * pide («el nivel importa menos que la dirección»). Un umbral inventado aquí se convertiría en un
 * semáforo rojo que nadie sabe apagar.
 */

import { ratio } from '@koinonia/domain';

import {
  dentroDe,
  medida,
  sellar,
  SIN_DATOS,
  validarVentana,
  EntradaInvalidaError,
  type Agregado,
  type EntradaDeliberacion,
  type InformeDeliberacion,
  type Medida,
} from './types.js';

function razon(numerador: number, denominador: number): Medida {
  return denominador === 0 ? SIN_DATOS : medida(ratio(numerador, denominador));
}

/**
 * Cuánto se delibera por cada cosa que se vota.
 *
 * El retorno es `Agregado<InformeDeliberacion>`. La llamada a `sellar()` va con la lista vacía
 * porque la entrada no trae identidades: no es un descuido, es la constatación de que esta métrica
 * no puede filtrar lo que nunca recibió.
 */
export function informeDeDeliberacion(entrada: EntradaDeliberacion): Agregado<InformeDeliberacion> {
  validarVentana(entrada.ventana);

  const deliberaciones = entrada.deliberaciones.filter((d) =>
    dentroDe(entrada.ventana, d.instante),
  );
  const votaciones = entrada.votaciones.filter((v) => dentroDe(entrada.ventana, v.instante));

  let intervenciones = 0;
  for (const deliberacion of deliberaciones) {
    if (!Number.isInteger(deliberacion.intervenciones) || deliberacion.intervenciones < 0) {
      throw new EntradaInvalidaError('las intervenciones deben ser un entero no negativo');
    }
    intervenciones += deliberacion.intervenciones;
  }

  let unanimes = 0;
  let sinDeliberacionPrevia = 0;
  for (const votacion of votaciones) {
    if (votacion.unanime) unanimes += 1;
    if (!votacion.conDeliberacionPrevia) sinDeliberacionPrevia += 1;
  }

  const informe: InformeDeliberacion = {
    ventana: entrada.ventana,
    deliberaciones: deliberaciones.length,
    intervenciones,
    votaciones: votaciones.length,
    votacionesUnanimes: unanimes,
    votacionesSinDeliberacionPrevia: sinDeliberacionPrevia,
    razon: razon(deliberaciones.length, votaciones.length),
    intervencionesPorVotacion: razon(intervenciones, votaciones.length),
    unanimidad: razon(unanimes, votaciones.length),
  };

  return sellar(informe, []);
}
