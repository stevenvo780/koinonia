/**
 * Los nueve métodos, dichos para quien nunca leyó teoría de la elección social.
 *
 * ═══ Por qué este fichero existe si el catálogo ya está en `@koinonia/contracts` ═══
 *
 * `METODOS_DISPONIBLES` (packages/contracts/src/metodos.ts) trae `nombre` y `descripcion`, y esa
 * descripción dice **qué hace** el método: «gana quien tenga más síes que noes». Eso es exacto y no
 * alcanza. Quien abre una votación no tiene delante nueve mecanismos que comparar: tiene un asunto
 * concreto —comprar una impresora, reformar el reglamento, repartir un presupuesto entre cuatro
 * salidas— y necesita saber **cuál le conviene a ESE asunto** y **cuál sería un error**. Esas dos
 * frases no son del contrato: son de la pantalla, cambian con la experiencia de la comunidad y no
 * las consume ni el motor ni el servidor. Por eso viven acá y no en `contracts`.
 *
 * Lo que sí se toma del contrato y no se repite: el nombre, la descripción, la forma de la papeleta
 * y si admite delegación. Si mañana el catálogo renombra un método, la pantalla lo dice renombrado
 * sin tocar este fichero.
 *
 * ═══ LO MÁS IMPORTANTE DE ESTE FICHERO: qué se puede responder hoy ═══
 *
 * El motor de `@koinonia/domain` sabe contar los nueve métodos. **La red no sabe transportar las
 * nueve papeletas.** `emitirPapeleta` (packages/contracts/src/http.ts) sólo tiene tres ramas —
 * `binary`, `abstain` y `consent`—, y `RespuestaPapeleta` en `services/api/src/http/service.ts`
 * repite exactamente esas tres. Cruzando eso con `acceptedPayloadKinds(method)` del dominio queda
 * esto:
 *
 *   · umbral (mayoría simple, mayoría reforzada, unanimidad) → admite `binary`/`abstain` → SÍ pasa.
 *   · acuerdo interno                                        → admite `consent`          → SÍ pasa.
 *   · deliberación aleatoria                                 → no admite NINGUNA papeleta, por
 *     diseño: el sorteo es el mecanismo, nadie llena nada.   → no hace falta que pase.
 *   · puntuación, voto por rondas, valoración por menciones, comparación por pares → exigen
 *     `score`, `ranking` o `grades`, y **ninguna de las tres cruza la red hoy**.
 *
 * Y hay una segunda razón, independiente de la red: `abrirDecision` en `service.ts` construye la
 * votación con **una sola opción** (`options: [optionId(input.propuestaId)]`, la propuesta misma).
 * Puntuar, ordenar o valorar por menciones con una única opción no es una votación reñida: es un
 * formulario sin contenido.
 *
 * Consecuencia para la pantalla, y es una decisión de producto, no un detalle: abrir una votación
 * con uno de esos cuatro métodos crearía una votación **que nadie puede responder**, en un historial
 * que no se corrige ni se borra. Así que la pantalla los muestra —quien abre tiene derecho a saber
 * que existen y para qué sirven— y no deja abrirlos, diciendo por qué con estas mismas palabras.
 *
 * `tests/unit/metodos-en-pantalla.test.ts` protege ese reparto. **No importa este fichero**, y no es
 * un descuido: `apps/web` no declara `"type": "module"`, así que bajo el `NodeNext` de
 * `tsconfig.check.json` —el que compila `tests/**`— cualquier fichero suyo se lee como CommonJS y
 * `verbatimModuleSyntax` lo rechaza; importarlo desde ahí rompe el `typecheck` del repositorio
 * entero. Es la misma razón por la que `vitest.config.ts` dice que `apps/web` no tiene suite
 * unitaria. Lo que esa prueba comprueba es el HECHO del que cuelga este reparto —qué papeleta admite
 * cada método y cuáles cruzan la red— y lleva escrita a mano la lista de los cuatro bloqueados, así
 * que el día que alguien añada al contrato la rama que falta, la prueba cae y su mensaje nombra este
 * fichero.
 */

import {
  METODOS_DISPONIBLES,
  ID_METODOS,
  type FormaPapeleta,
  type IdMetodo,
} from '@koinonia/contracts';

/**
 * Qué formulario dibuja la pantalla de la papeleta, y si se puede dibujar alguno.
 *
 * No es `FormaPapeleta` del catálogo: aquélla describe la papeleta **ideal** del método, ésta
 * describe lo que la pantalla puede poner delante de alguien hoy sin mentirle. `todavia-no` es la
 * diferencia entre las dos, y existir tiene todo el sentido: el día que desaparezca, desaparece
 * junto con la rama del contrato que falta.
 */
export type FormularioDePapeleta =
  /** Sí / No / me abstengo, sobre un único texto. */
  | 'binaria'
  /** Sin objeción / tengo una reserva / objeto, con la objeción por escrito. */
  | 'consentimiento'
  /** No hay nada que llenar: lo que decide es el sorteo. */
  | 'sin-papeleta'
  /** El método existe y se cuenta, pero la respuesta todavía no tiene por dónde entrar. */
  | 'todavia-no';

/** Lo que hay que decirle a alguien sobre un método antes de que lo elija. */
export interface MetodoEnPalabras {
  readonly id: IdMetodo;
  /** Una frase: en qué clase de asunto conviene éste y no otro. */
  readonly cuandoConviene: string;
  /** Un ejemplo del instituto, para reconocer el caso propio sin traducir nada. */
  readonly ejemplo: string;
  /** El error típico: cuándo elegir éste sería un error, dicho sin rodeos. */
  readonly cuandoNo: string;
  /** Qué va a ver quien responda. Es la promesa que la papeleta tiene que cumplir. */
  readonly queLlenaLaGente: string;
  /** Qué formulario dibuja la pantalla hoy. */
  readonly formulario: FormularioDePapeleta;
}

const EN_PALABRAS: Readonly<Record<IdMetodo, Omit<MetodoEnPalabras, 'id'>>> = {
  'simple-majority': {
    cuandoConviene:
      'Cuando hay un solo texto sobre la mesa, lo que se decide no cambia las reglas del grupo y ' +
      'basta con saber si hay más gente a favor que en contra.',
    ejemplo: 'Aprobar el acta de la asamblea pasada. Comprar la impresora del salón.',
    cuandoNo:
      'Si lo que se decide va a atar al grupo mucho después de este semestre, o si en realidad hay ' +
      'tres salidas distintas y no una.',
    queLlenaLaGente: 'Sí, no, o me abstengo, sobre un único texto.',
    formulario: 'binaria',
  },
  supermajority: {
    cuandoConviene:
      'Cuando lo que se cambia compromete al grupo más allá de la mayoría de un día: las reglas ' +
      'internas, un compromiso largo, algo que costaría deshacer.',
    ejemplo: 'Reformar el reglamento del estudiantado. Cambiar cómo se eligen los representantes.',
    cuandoNo:
      'Para lo cotidiano. Exigir dos de cada tres para comprar una impresora no protege a nadie: ' +
      'es una forma cara de no decidir.',
    queLlenaLaGente:
      'Sí, no, o me abstengo, sobre un único texto. Lo que cambia no es la papeleta: es cuántos ' +
      'síes hacen falta.',
    formulario: 'binaria',
  },
  unanimity: {
    cuandoConviene:
      'Sólo cuando el grupo es pequeño y lo que se decide no se le puede imponer a nadie: basta ' +
      'que una persona diga que no para que no pase.',
    ejemplo: 'Un compromiso que cada integrante del círculo va a tener que cumplir en persona.',
    cuandoNo:
      'Con trescientas personas. Ahí la unanimidad no protege a la minoría: le entrega el veto a ' +
      'quien no respondió.',
    queLlenaLaGente:
      'Sí, no, o me abstengo. Salvo que el círculo diga lo contrario al abrir, abstenerse también ' +
      'rompe el acuerdo.',
    formulario: 'binaria',
  },
  'sociocratic-consent': {
    cuandoConviene:
      'Cuando lo que importa no es a cuánta gente le gusta, sino que nadie muestre un daño ' +
      'concreto. La pregunta que se hace es «¿alguien objeta?», no «¿te gusta?».',
    ejemplo: 'Un acuerdo de trabajo dentro de un círculo. Cómo se reparte una tarea entre cuatro.',
    cuandoNo:
      'Si quienes deciden no se conocen entre sí. Una objeción sin nadie con quien hablarla ' +
      'detiene todo y no se resuelve.',
    queLlenaLaGente:
      'Tres respuestas, no un sí o un no: sin objeción, tengo una reserva, objeto. Objetar bloquea, ' +
      'y por eso exige decir qué objetivo del grupo se daña y por qué.',
    formulario: 'consentimiento',
  },
  score: {
    cuandoConviene:
      'Cuando hay varias salidas y lo que hace falta saber es cuánto le sirve cada una a cada ' +
      'quien, no cuál es la favorita de nadie.',
    ejemplo: 'Repartir un presupuesto chico entre cuatro actividades que no se excluyen.',
    cuandoNo:
      'Si sólo hay un texto que aprobar o rechazar: ponerle nota a una sola cosa no dice nada que ' +
      'un sí o un no no diga mejor.',
    queLlenaLaGente:
      'Una nota de 0 a 5 para cada salida. Puntuar no es ordenar: dos salidas pueden llevarse la ' +
      'misma nota, y dejar una en blanco significa «no opino», no cero.',
    formulario: 'todavia-no',
  },
  irv: {
    cuandoConviene:
      'Cuando hay varias salidas, hay que quedarse con una sola, y no querés que dos parecidas se ' +
      'quiten apoyo entre sí y pierdan las dos.',
    ejemplo: 'Elegir una única fecha de asamblea entre cinco propuestas.',
    cuandoNo:
      'Si las salidas no se excluyen entre sí y podrían convivir. Ahí obligar a elegir una sola ' +
      'inventa un conflicto que no existía.',
    queLlenaLaGente:
      'Las salidas ordenadas, de la que más se prefiere a la que menos. Ordenar no es elegir una: ' +
      'hay que decir también qué va segundo, porque de eso vive el método.',
    formulario: 'todavia-no',
  },
  'majority-judgment': {
    cuandoConviene:
      'Cuando ordenar de mejor a peor no dice bastante: acá cada salida recibe su propia mención, ' +
      'y dos pueden ser buenas sin que haya que decidir cuál va primero.',
    ejemplo: 'Valorar cuatro propuestas de reforma que llegaron por separado.',
    cuandoNo:
      'Si el grupo no va a leer las cuatro. Una mención puesta sin haber leído pesa igual que una ' +
      'puesta con criterio, y acá se nota más que en otros métodos.',
    queLlenaLaGente:
      'Una mención por salida, elegida de una escala fijada al abrir —de «Excelente» a «Rechazar»—. ' +
      'Quien deja una salida sin mención pierde la papeleta entera, así que hay que valorarlas todas.',
    formulario: 'todavia-no',
  },
  'condorcet-schulze': {
    cuandoConviene:
      'Cuando querés la salida que le gana a todas las demás una contra una, y no la que más ' +
      'primeros puestos junta.',
    ejemplo:
      'Elegir entre tres líneas de trabajo cuando sospechás que la más votada en primer lugar es ' +
      'también la que más gente rechaza.',
    cuandoNo:
      'Si hace falta explicar el resultado en dos minutos en una asamblea. Es el método más difícil ' +
      'de contar en voz alta de los nueve.',
    queLlenaLaGente:
      'Las salidas ordenadas, de la que más se prefiere a la que menos. Lo que no se ordena queda ' +
      'empatado en el último lugar: nunca se le inventa un orden a nadie.',
    formulario: 'todavia-no',
  },
  'deliberative-sortition': {
    cuandoConviene:
      'Cuando el asunto exige leer mucho antes de opinar y no es razonable pedirle eso a ' +
      'trescientas personas: se sortea un grupo pequeño y ese grupo delibera y decide.',
    ejemplo: 'Revisar un pliego largo antes de que llegue a la asamblea.',
    cuandoNo:
      'Si lo que se decide toca directamente a quien no salió sorteado. Delegar en una muestra sólo ' +
      'es legítimo cuando el grupo entero lo decidió antes.',
    queLlenaLaGente:
      'Nada: nadie llena una papeleta. El número del sorteo se anuncia sellado antes de abrir y se ' +
      'abre al cerrar, para que cualquiera pueda rehacer el sorteo y comprobar que salió eso.',
    formulario: 'sin-papeleta',
  },
};

/** El método, dicho en palabras. La lengua de esta pantalla, no del contrato. */
export function enPalabras(id: IdMetodo): MetodoEnPalabras {
  return { id, ...EN_PALABRAS[id] };
}

/** Los nueve, en el orden pedagógico del catálogo. */
export const METODOS_EN_PALABRAS: readonly MetodoEnPalabras[] = ID_METODOS.map(enPalabras);

/** Cómo se llama en pantalla. Sale del catálogo, nunca de acá: una sola fuente para el nombre. */
export function nombreDelMetodo(id: IdMetodo): string {
  return METODOS_DISPONIBLES[id].nombre;
}

/** La descripción del catálogo: qué hace el método. El «cuándo conviene» es de este fichero. */
export function descripcionDelMetodo(id: IdMetodo): string {
  return METODOS_DISPONIBLES[id].descripcion;
}

/** La forma de papeleta que el catálogo declara. Es lo ideal, no siempre lo alcanzable. */
export function formaIdealDePapeleta(id: IdMetodo): FormaPapeleta | undefined {
  return METODOS_DISPONIBLES[id].formasPapeleta[0];
}

/** Si en este método se puede prestar el voto. Lo declara el catálogo y lo aplica el motor. */
export function admiteDelegacion(id: IdMetodo): boolean {
  return METODOS_DISPONIBLES[id].delegacionPermitida;
}

/**
 * Si hoy se puede abrir una votación con este método sin dejarla sin respuesta posible.
 *
 * `false` **no** significa «el método está mal» ni «el motor no lo sabe contar»: significa que la
 * papeleta que exige todavía no cruza la red. Ver la cabecera del fichero.
 */
export function sePuedeAbrirHoy(id: IdMetodo): boolean {
  return EN_PALABRAS[id].formulario !== 'todavia-no';
}

/**
 * Por qué todavía no, dicho para quien abre y no para quien programa.
 *
 * Son dos motivos y los dos son ciertos a la vez. Se dicen los dos porque resolver sólo uno no
 * habilitaría el método, y prometer lo contrario sería mentir sobre cuánto falta.
 */
export function porQueTodaviaNo(id: IdMetodo): string {
  return (
    `«${nombreDelMetodo(id)}» pide una papeleta que la votación todavía no sabe recibir, así que ` +
    `quien entrara a responder no encontraría dónde hacerlo. Y hay una segunda razón: hoy una ` +
    `votación se abre sobre un solo texto, y este método sólo dice algo cuando hay varias salidas ` +
    `que comparar. Las dos cosas se resuelven fuera de esta pantalla; el día que estén, el método ` +
    `se habilita acá sin cambiar nada de lo que ves.`
  );
}
