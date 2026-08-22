/**
 * Métrica 4 — **rotación del núcleo activo**.
 *
 * §6: qué parte de la décima parte más activa del período anterior ya no lo es, más qué parte de
 * quienes participan ahora son nuevos. «Distingue estabilidad de oligarquía y anticipa el bus
 * factor con semestres de margen.» Si siempre son las mismas personas, la asamblea está capturada
 * aunque el resto del panel esté en verde.
 *
 * # El núcleo se define por un corte, no por un ranking
 *
 * La formulación de §6 —«el decil más activo»— invita a ordenar personas por actividad y quedarse
 * con las primeras. Eso es literalmente el artefacto que el ADR-0040 prohíbe, aunque la lista no
 * salga por ninguna parte: en cuanto existe, alguien la devuelve.
 *
 * Aquí se hace al revés. Se ordenan **los conteos** —números, sin dueño—, se toma el valor que
 * ocupa la posición del corte, y el núcleo es *el conjunto de quienes llegan a ese número*. Nunca
 * se ordena a nadie, y la pertenencia al núcleo es una propiedad de la distribución, no una
 * posición en una tabla. Efecto lateral deseable: los empates entran completos, así que el núcleo
 * puede ser mayor que la décima parte exacta y **no hay que decidir a cuál de dos personas
 * empatadas se corta**, decisión que no tendría ninguna justificación defendible.
 *
 * El corte se publica (`corteAnterior`, `corteActual`) para que la cifra sea recomputable: quien
 * dude puede rehacer el cálculo con la distribución de aportes y comprobar que sale lo mismo.
 *
 * # k-anonimato
 *
 * Un núcleo de tres personas rotando en un 66 % es una frase sobre dos personas concretas. Si
 * cualquiera de los dos núcleos queda por debajo de `K_NO_SE_PUBLICA`, no se publica el cambio.
 */

import { ratio } from '@koinonia/domain';

import {
  dentroDe,
  K_NO_SE_PUBLICA,
  K_SE_ADVIERTE,
  NO_SE_PUBLICA,
  sellar,
  validarVentana,
  type Agregado,
  type Aporte,
  type CambioDelNucleo,
  type Desglose,
  type EntradaRotacion,
  type InformeRotacion,
  type Ventana,
} from './types.js';

/** Una décima parte. §6 habla del «decil más activo»; el número vive aquí y no repartido por el código. */
const PARTE_DEL_NUCLEO = 10;

/** Conteo de aportes por persona dentro de la ventana. Es interno y no sale nunca del módulo. */
function conteos(aportes: readonly Aporte[], ventana: Ventana): ReadonlyMap<string, number> {
  const porAutor = new Map<string, number>();
  for (const aporte of aportes) {
    if (!dentroDe(ventana, aporte.instante)) continue;
    porAutor.set(aporte.autor, (porAutor.get(aporte.autor) ?? 0) + 1);
  }
  return porAutor;
}

/**
 * El número de aportes a partir del cual se pertenece al núcleo.
 *
 * Ordena **conteos**, no personas. Con `n` participantes el corte es el conteo que ocupa la
 * posición `⌈n/10⌉` empezando por el más alto; con menos de diez participantes eso es el máximo, es
 * decir, el núcleo es quien más participó (y todos los que empaten con él).
 */
function corteDelNucleo(porAutor: ReadonlyMap<string, number>): number {
  const valores = [...porAutor.values()].sort((a, b) => b - a);
  if (valores.length === 0) return 0;
  const posicion = Math.ceil(valores.length / PARTE_DEL_NUCLEO) - 1;
  return valores[posicion] ?? 0;
}

/** Quiénes llegan al corte. Conjunto, no lista: un conjunto no tiene primero ni último. */
function nucleo(porAutor: ReadonlyMap<string, number>, corte: number): ReadonlySet<string> {
  const dentro = new Set<string>();
  for (const [persona, aportes] of porAutor) {
    if (aportes >= corte) dentro.add(persona);
  }
  return dentro;
}

/**
 * Rotación del núcleo activo entre dos períodos.
 *
 * El retorno es `Agregado<InformeRotacion>` y pasa por `sellar()` con las identidades de ambos
 * períodos: es la métrica que más cerca está de necesitar nombres, y por eso es la que más
 * vigilancia necesita.
 */
export function informeDeRotacion(entrada: EntradaRotacion): Agregado<InformeRotacion> {
  validarVentana(entrada.periodoAnterior);
  validarVentana(entrada.periodoActual);

  const antes = conteos(entrada.aportesAnteriores, entrada.periodoAnterior);
  const ahora = conteos(entrada.aportesActuales, entrada.periodoActual);

  const corteAnterior = corteDelNucleo(antes);
  const corteActual = corteDelNucleo(ahora);
  const nucleoAntes = nucleo(antes, corteAnterior);
  const nucleoAhora = nucleo(ahora, corteActual);

  const publicable =
    nucleoAntes.size >= K_NO_SE_PUBLICA &&
    nucleoAhora.size >= K_NO_SE_PUBLICA &&
    antes.size >= K_NO_SE_PUBLICA &&
    ahora.size >= K_NO_SE_PUBLICA;

  let cambio: Desglose<CambioDelNucleo> = NO_SE_PUBLICA;
  if (publicable) {
    let salieron = 0;
    for (const persona of nucleoAntes) {
      if (!nucleoAhora.has(persona)) salieron += 1;
    }
    let personasNuevas = 0;
    for (const persona of ahora.keys()) {
      if (!antes.has(persona)) personasNuevas += 1;
    }
    cambio = {
      publicado: true,
      // El tamaño del grupo relevante para el aviso de «grupo pequeño» es el núcleo anterior, que
      // es el denominador de la rotación.
      personas: nucleoAntes.size,
      grupoPequeno: nucleoAntes.size < K_SE_ADVIERTE,
      valor: {
        nucleoAnterior: nucleoAntes.size,
        nucleoActual: nucleoAhora.size,
        salieron,
        rotacion: ratio(salieron, nucleoAntes.size),
        personasNuevas,
        proporcionDePersonasNuevas: ratio(personasNuevas, ahora.size),
        corteAnterior,
        corteActual,
      },
    };
  }

  const informe: InformeRotacion = {
    periodoAnterior: entrada.periodoAnterior,
    periodoActual: entrada.periodoActual,
    participantesAnteriores: antes.size,
    participantesActuales: ahora.size,
    cambio,
  };

  return sellar(informe, [
    ...entrada.aportesAnteriores.map((a) => a.autor),
    ...entrada.aportesActuales.map((a) => a.autor),
  ]);
}
