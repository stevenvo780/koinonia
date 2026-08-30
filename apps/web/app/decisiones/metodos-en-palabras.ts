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
 * ═══ Dos preguntas distintas, y sólo una las confunde a las dos ═══
 *
 * «¿Se puede RESPONDER este método?» y «¿se puede ABRIR una votación nueva con este método?» solían
 * tener la misma respuesta, porque las dos estaban bloqueadas por la misma causa: `emitirPapeleta`
 * (`packages/contracts/src/http.ts`) sólo transportaba tres clases de papeleta —`binary`, `abstain`,
 * `consent`— y puntuación, voto por rondas, valoración por menciones y comparación por pares exigen
 * `score`, `ranking` o `grades` (`acceptedPayloadKinds` en `@koinonia/domain`), ninguna de las tres.
 *
 * Esa frontera ya tiene las seis clases que el motor necesita —ver `emitirPapeleta` y
 * `payloadDePapeleta` en `services/api/src/http/service.ts`—, así que la primera pregunta ya es sí
 * para los nueve (el sorteo no necesita papeleta ninguna, por diseño). La segunda sigue siendo no
 * para esos cuatro, y por una razón que no tiene nada que ver con la red: `abrirDecision`
 * (`service.ts`) construye toda votación con **una sola opción**
 * (`options: [optionId(input.propuestaId)]`, la propuesta misma), y esos cuatro métodos EXISTEN para
 * comparar varias salidas entre sí. Puntuar, ordenar o valorar por menciones una única opción no es
 * una votación reñida: es un formulario cuya respuesta ya se sabe de antemano, y abrir una así sería
 * fingir una elección que no existe. El día que una decisión se pueda abrir con más de una opción,
 * `sePuedeAbrirHoy` deja de excluir a estos cuatro sin que haga falta tocar ninguna otra pantalla.
 *
 * `tests/unit/metodos-en-pantalla.test.ts` protege la PRIMERA pregunta contra el dominio y el
 * contrato — qué papeleta admite cada método y cuáles cruzan la red—; la segunda es una decisión de
 * producto sin invariante de dominio que comprobar, así que vive sólo acá. **No importa este
 * fichero**, y no es un descuido: `apps/web` no declara `"type": "module"`, así que bajo el
 * `NodeNext` de `tsconfig.check.json` —el que compila `tests/**`— cualquier fichero suyo se lee como
 * CommonJS y `verbatimModuleSyntax` lo rechaza; importarlo desde ahí rompe el `typecheck` del
 * repositorio entero. Es la misma razón por la que `vitest.config.ts` dice que `apps/web` no tiene
 * suite unitaria.
 */

import {
  METODOS_DISPONIBLES,
  ID_METODOS,
  type FormaPapeleta,
  type IdMetodo,
} from '@koinonia/contracts';

/**
 * Qué formulario dibuja la pantalla de la papeleta.
 *
 * No es `FormaPapeleta` del catálogo: aquélla nombra la papeleta que el motor espera; ésta nombra
 * el formulario concreto que `apps/web/app/decisiones/[id]/page.tsx` sabe dibujar para esa papeleta.
 * Las dos coinciden uno a uno para los nueve métodos — la red ya transporta las seis clases que el
 * motor exige —, y por eso cada entrada de abajo repite el mismo valor que su `formasPapeleta[0]`
 * del catálogo. Que se pueda DIBUJAR el formulario no dice si esta pantalla deja ABRIR una votación
 * nueva con ese método: eso lo decide `sePuedeAbrirHoy`, más abajo, por una razón completamente
 * distinta.
 */
export type FormularioDePapeleta =
  /** Sí / No / me abstengo, sobre un único texto. */
  | 'binaria'
  /** Sin objeción / tengo una reserva / objeto, con la objeción por escrito. */
  | 'consentimiento'
  /** Una nota de 0 a 5 por opción, o «sin opinión». */
  | 'puntuacion'
  /** Las opciones ordenadas de la que más se prefiere a la que menos. */
  | 'ordenamiento'
  /** Una mención por opción, elegida de la escala congelada al abrir. */
  | 'menciones'
  /** No hay nada que llenar: lo que decide es el sorteo. */
  | 'sin-papeleta'
  /** Un consejo escrito con su postura — y, para quien decide, el sí o el no. */
  | 'consejo'
  /** De acuerdo / con reservas / me aparto / bloqueo, con motivo escrito en los dos últimos. */
  | 'consenso';

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
    formulario: 'puntuacion',
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
    formulario: 'ordenamiento',
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
    formulario: 'menciones',
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
    formulario: 'ordenamiento',
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
  'advice-process': {
    cuandoConviene:
      'Para lo que una asamblea no debería votar: qué herramienta usar, cómo redactar un aviso, a ' +
      'quién invitar. Decide una sola persona, pero no puede resolver hasta que varias le hayan ' +
      'dejado su consejo por escrito. El consejo NO la ata — puede ir en contra de todo lo que le ' +
      'dijeron, y eso está permitido. Lo que no está permitido es no preguntar.',
    ejemplo: 'Elegir con qué programa se llevan las actas. Decidir el horario de una jornada.',
    cuandoNo:
      'Si el asunto reparte poder, plata o sanciones. Ahí tiene que decidir el grupo, no una ' +
      'persona por bien intencionada que sea. Votar eso convierte una operación en plebiscito; ' +
      'decidir a puerta cerrada lo que sí toca al grupo lo convierte en privilegio.',
    queLlenaLaGente:
      'Casi todo el mundo escribe un consejo: si le parece bien, mal o con matices, y por qué — el ' +
      'porqué es obligatorio, porque sin razones no es consejo. Quien decide no aconseja: cuando ya ' +
      'hay consejos suficientes, le aparece el sí o el no.',
    formulario: 'consejo',
  },
  consensus: {
    cuandoConviene:
      'Cuando hace falta que el grupo entero pueda vivir con lo que se decida y querés que el ' +
      'desacuerdo quede escrito en vez de tragado. Tiene una figura que ningún otro método de acá ' +
      'tiene: apartarse — «no lo apoyo, no lo voy a impedir, y quiero que conste».',
    ejemplo: 'Cambiar cómo se reparten los turnos de la sala. Fijar la línea de un comunicado.',
    cuandoNo:
      'Si el grupo es grande y el asunto urgente: el consenso se cae con un solo bloqueo, y eso le ' +
      'da a una persona el poder de detener a todas. Para eso está la mayoría, que decide aunque ' +
      'incomode. Y si lo que querés es que nadie objete con daño argumentado, el acuerdo interno ' +
      'hace eso mejor y sin el tope de apartados.',
    queLlenaLaGente:
      'Una de cuatro: de acuerdo, de acuerdo con reservas, me aparto, o bloqueo. Las dos últimas ' +
      'piden escribir el motivo — apartarse sin decir de qué no deja constancia de nada, y bloquear ' +
      'le impide algo a todo el mundo. Se aprueba si nadie bloqueó y los apartados no pasan del tope.',
    formulario: 'consenso',
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

/** La forma de papeleta que el catálogo declara. Coincide con `enPalabras(id).formulario`. */
export function formaIdealDePapeleta(id: IdMetodo): FormaPapeleta | undefined {
  return METODOS_DISPONIBLES[id].formasPapeleta[0];
}

/** Si en este método se puede prestar el voto. Lo declara el catálogo y lo aplica el motor. */
export function admiteDelegacion(id: IdMetodo): boolean {
  return METODOS_DISPONIBLES[id].delegacionPermitida;
}

/**
 * Los cuatro métodos que EXISTEN para comparar varias salidas entre sí, y por eso no dicen nada
 * útil sobre la única opción que `abrirDecision` sabe construir hoy.
 *
 * Está escrita a mano y no derivada de `formulario` (que ya no distingue estos cuatro de los
 * cinco restantes: los nueve tienen una papeleta real). Es la lista que cuelga de una decisión de
 * producto, no de un hecho del dominio — el día que una decisión pueda abrirse con más de una
 * opción, se vacía esta lista y con ella se abre la puerta a los cuatro, sin tocar nada más de
 * este fichero.
 */
const METODOS_QUE_COMPARAN_OPCIONES: readonly IdMetodo[] = [
  'score',
  'irv',
  'majority-judgment',
  'condorcet-schulze',
];

/**
 * Si hoy se puede abrir una votación con este método.
 *
 * `false` **no** significa «el método está mal», «el motor no lo sabe contar» ni «la papeleta no
 * cruza la red» —las tres cosas ya son ciertas para los nueve—: significa que este método compara
 * varias salidas y `abrirDecision` sólo sabe abrir sobre una. Ver la cabecera del fichero.
 */
export function sePuedeAbrirHoy(id: IdMetodo): boolean {
  return !METODOS_QUE_COMPARAN_OPCIONES.includes(id);
}

/**
 * Por qué todavía no, dicho para quien abre y no para quien programa.
 *
 * Un solo motivo, no dos: hasta hace poco había otro —la papeleta no cruzaba la red—, y prometer
 * los dos a la vez cuando sólo queda uno sería mentir sobre cuánto falta. Ver
 * `docs/OBJETIVO.md` para el estado completo del incremento.
 */
export function porQueTodaviaNo(id: IdMetodo): string {
  return (
    `«${nombreDelMetodo(id)}» existe para comparar varias salidas entre sí, y hoy toda votación ` +
    `se abre sobre un único texto. Con una sola opción sobre la mesa, la respuesta ya se sabe de ` +
    `antemano, así que abrir la votación así sería fingir una elección que no existe. El día que ` +
    `una decisión se pueda abrir con más de una opción, este método se habilita acá sin cambiar ` +
    `nada de lo que ves.`
  );
}
