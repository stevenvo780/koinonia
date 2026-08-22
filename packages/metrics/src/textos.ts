/**
 * Los textos de pantalla, separados del cálculo (ADR-0041).
 *
 * Ninguna cadena de este fichero dice «HHI», «Herfindahl», «índice de concentración», «decil»,
 * «percentil» ni ninguna otra jerga. No es cosmética: en el momento en que la pantalla dice
 * «índice normalizado», el mensaje que recibe quien lee es *este no es tu terreno y no vas a poder
 * verificar nada*, y esa persona deja de mirar el panel. El rigor va en el motor; el rótulo va en
 * castellano llano. `test/textos.test.ts` comprueba la lista negra término por término.
 *
 * La traducción de «concentración de la voz» es la que el propio ADR-0041 fija en su tabla
 * normativa: **«qué tan repartida está la voz»**. Se usa esa y no una propia, para que la misma
 * cosa no tenga dos nombres en dos pantallas.
 *
 * Las cifras se formatean con `toPercentString` del dominio, que trunca hacia cero con aritmética
 * exacta. Truncar y no redondear es deliberado: «49,9 %» nunca debe leerse como «50 %» y sugerir
 * que se alcanzó un mínimo que no se alcanzó.
 */

import { toPercentString, type Fraction } from '@koinonia/domain';

import { K_NO_SE_PUBLICA, K_SE_ADVIERTE, type Medida } from './types.js';

/** Porcentaje para mostrar, exacto y truncado. Nunca alimenta una comparación. */
export function comoPorcentaje(valor: Fraction, decimales = 1): string {
  return toPercentString(valor, decimales);
}

/** `3/2` → «1,5 por cada una». Para razones, que pueden pasar de 1 y no son porcentajes. */
export function comoRazon(valor: Fraction, decimales = 1): string {
  const escala = 10n ** BigInt(decimales);
  const escalado = (valor.num * escala) / valor.den;
  const texto = escalado.toString().padStart(decimales + 1, '0');
  const entero = texto.slice(0, texto.length - decimales);
  const resto = texto.slice(texto.length - decimales);
  return decimales === 0 ? entero : `${entero},${resto}`;
}

/** Formatea una medida, o dice que no hay con qué. */
export function medidaEnPorcentaje(medida: Medida): string {
  return medida.hay ? comoPorcentaje(medida.valor) : TEXTOS.sinDatos;
}

export const TEXTOS = {
  panelTitulo: 'Cómo va la vida en común',
  panelDescripcion:
    'Cinco medidas del conjunto. Ninguna habla de personas: aquí no hay listas de quién ' +
    'participa más, ni puntajes, ni insignias, ni rachas. Miran cómo está el grupo, no cómo está ' +
    'cada quien.',
  panelSerie:
    'Cada cifra se lee con su historia detrás: importa menos dónde está hoy que hacia dónde va.',
  sinDatos: 'No hay datos suficientes para decirlo.',

  // ── 1. Acuerdos ───────────────────────────────────────────────────────────────────────────────
  acuerdosTitulo: 'Lo que se decide, ¿se hace?',
  acuerdosDescripcion:
    'De los compromisos cuya fecha vencía en este período, cuántos quedaron hechos. Es la medida ' +
    'principal: si decidir no cambia nada, todo lo demás es decorado.',
  acuerdosDeudaTitulo: 'Compromisos vencidos que siguen abiertos',
  acuerdosDeudaDescripcion:
    'Lo que se prometió, ya pasó la fecha y todavía no está cerrado. No es un reproche a nadie: ' +
    'casi siempre es exceso de carga, y por eso se mira por círculo y por tipo de tarea, nunca ' +
    'por persona.',
  acuerdosRelojDetenido:
    'Los compromisos en los que alguien avisó que está bloqueado o pidió ayuda no cuentan como ' +
    'incumplidos: al avisar, el plazo se detiene. Si avisar costara caro, nadie avisaría.',
  acuerdosPrescritos:
    'Los atrasos de más de dos semestres dejan de contarse. Un compromiso viejo no puede seguir ' +
    'pesando para siempre.',
  acuerdosCumplidosTarde: 'Cumplidos después de la fecha. Cuentan como hechos, y también aparte.',
  acuerdosBajoLaMitad:
    'Menos de la mitad de los compromisos vencidos llegaron a cerrarse. Si esto se sostiene, ' +
    'quiere decir que decidir aquí no está sirviendo para nada.',
  acuerdosSanos: 'Más de la mitad de los compromisos vencidos llegaron a cerrarse.',
  acuerdosSinVencimientos:
    'En este período no vencía ningún compromiso, así que no hay nada que medir todavía.',
  acuerdosPorCirculo: 'Por círculo',
  acuerdosPorTipo: 'Por tipo de tarea',

  // ── 2. Voz ────────────────────────────────────────────────────────────────────────────────────
  // El rótulo lo fija la tabla del ADR-0041. No se cambia sin cambiar el ADR.
  vozTitulo: 'Qué tan repartida está la voz',
  vozDescripcion:
    'Si hablan muchas personas y hablan parecido, la palabra está repartida. Si casi todo lo dice ' +
    'muy poca gente, esto es un club con público. No dice quién habló ni cuánto habló cada quien.',
  vozRepartida: 'La palabra está repartida entre bastante gente.',
  vozConcentrada:
    'La palabra está concentrada en muy poca gente. No invalida nada de lo que se haya decidido: ' +
    'es un aviso para la asamblea.',
  vozMayorParticipacion:
    'Qué parte del total puso quien más habló, comparado con el tamaño de la comunidad.',
  vozEscala: 'De 0 —todo el mundo habla parecido— a 100 —habla una sola persona—.',

  // ── 3. Cobertura ──────────────────────────────────────────────────────────────────────────────
  coberturaTitulo: 'A cuánta gente llega esto',
  coberturaDescripcion:
    'Qué parte de la comunidad hizo al menos una cosa en el período. Se mira por grupos, porque ' +
    'el número general engaña: 40 de cada 100 en total, con 8 de cada 100 en la jornada de la ' +
    'noche, es una plataforma diurna que se cree de todos.',
  coberturaEjes:
    'Los grupos son: semestre, jornada, pregrado o posgrado, y si ya participaba antes.',
  coberturaSinGenero:
    'El género no se usa para agrupar. Es un dato sensible y ligarlo a una persona dentro de un ' +
    'registro público está prohibido por la ley de datos personales.',
  coberturaBrecha:
    'Distancia entre el grupo al que más llega y el grupo al que menos llega, dentro de una misma ' +
    'forma de agrupar.',
  coberturaCruce: 'Semestre y jornada, cruzados',

  // ── 4. Rotación ───────────────────────────────────────────────────────────────────────────────
  rotacionTitulo: 'Si siempre son las mismas personas',
  rotacionDescripcion:
    'De quienes más participaron el período pasado, cuántos ya no están ahí; y cuánta gente ' +
    'aparece por primera vez. Sirve para distinguir un grupo estable de un grupo cerrado.',
  rotacionCorte:
    'Se considera que alguien participa mucho a partir de cierto número de intervenciones, y ese ' +
    'número se publica para que cualquiera pueda rehacer la cuenta. Quien empata con el corte, ' +
    'entra: no se parte por la mitad a dos personas que hicieron lo mismo.',
  rotacionNula:
    'El grupo que más participa no cambió nada respecto al período anterior. Todo lo demás puede ' +
    'estar en orden y aun así esto merece una conversación.',
  rotacionPersonasNuevas: 'Gente que participa ahora y no participaba antes.',

  // ── 5. Deliberación ───────────────────────────────────────────────────────────────────────────
  deliberacionTitulo: 'Cuánto se conversa antes de contar votos',
  deliberacionDescripcion:
    'Cuántas conversaciones hubo por cada votación cerrada. Si se vota mucho más de lo que se ' +
    'conversa, no se está deliberando: se está contando.',
  deliberacionSinVotaciones: 'En este período no se cerró ninguna votación.',
  unanimidadTitulo: 'Votaciones sin un solo voto en contra',
  unanimidadDescripcion:
    'Que todo salga por unanimidad no siempre es buena señal: puede querer decir que quien no ' +
    'estaba de acuerdo dejó de venir. No hay un número bueno ni uno malo; lo que dice algo es ' +
    'cómo cambia con el tiempo.',
  votacionesSinConversacion: 'Votaciones que se cerraron sin ninguna conversación previa.',

  // ── Grupos pequeños ───────────────────────────────────────────────────────────────────────────
  noSePublicaTitulo: 'Este desglose no se publica',
  noSePublicaDescripcion:
    `En este grupo hay menos de ${K_NO_SE_PUBLICA.toString()} personas. Con tan poca gente, un ` +
    'promedio deja de ser un promedio: cualquiera que conozca al grupo puede deducir por descarte ' +
    'qué hizo cada quien. El dato existe y no se muestra, y se prefiere decirlo a dejar un hueco ' +
    'en blanco.',
  grupoPequenoAdvertencia: (personas: number): string =>
    `Este grupo tiene ${personas.toString()} personas, menos de ${K_SE_ADVIERTE.toString()}. La ` +
    'cifra se publica, pero con tan poca gente se mueve mucho por muy poco: conviene leerla con ' +
    'cuidado y mirar sobre todo cómo cambia.',
  celdasRetenidas: (cuantas: number): string =>
    cuantas === 0
      ? 'Se publican todos los desgloses.'
      : `${cuantas.toString()} ${cuantas === 1 ? 'desglose no se publica' : 'desgloses no se publican'} ` +
        'por tener demasiada poca gente dentro.',

  // ── Lo que este panel NO hace ─────────────────────────────────────────────────────────────────
  loQueNoSeMide:
    'Aquí no se mide la actividad de cada persona. No hay mensajes por persona, ni tiempo ' +
    'conectado, ni tareas cumplidas ordenadas por nombre, y no es que falten: están prohibidos. ' +
    'Lo que se vigila es el estado de lo común, no la conducta de la gente.',
} as const;
