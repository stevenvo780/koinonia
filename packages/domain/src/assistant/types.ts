/**
 * Asistente de acción sistémica: tipos, eventos, estado y **el puerto de IA**.
 *
 * ═══ La regla que manda, y cómo se hace cumplir sin confiar en nadie ═══
 *
 * Principio 6 del proyecto: **la IA asesora, estructura y facilita; nunca gobierna ni vota.** Sin
 * excepciones y sin banderas de configuración. Un comentario que diga eso no vale nada: lo que vale
 * es que el tipo de retorno del puerto **no pueda expresar** una decisión ni un cambio de estado, y
 * eso es lo que hacen `Inocuo` y `Sugerencia`.
 *
 * Cuatro capas, de la más fuerte a la más débil, y ninguna sobra:
 *
 *  1. **El puerto no conoce identificadores.** `Sugerencia` no tiene `borradorId`, ni `MemberId`, ni
 *     `ProposalId`, ni `DecisionId`. Una implementación no puede **nombrar** nada del sistema, así
 *     que tampoco puede dirigirse a nada. Ni siquiera pone el `sugerenciaId`: ese lo asigna quien
 *     registra la sugerencia, ya dentro del historial.
 *  2. **El contenido sólo transporta texto** (y números de pregunta). `Inocuo<C>` vale `never` en
 *     cuanto `C` contiene un `boolean` —que es un veredicto—, un `number` suelto —que es un peso o
 *     una puntuación—, un identificador de marca, una función —que es una mutación— o cualquier
 *     otra cosa. Un campo `never` **no se puede construir**: la implementación no compila.
 *  3. **El pliegue revalida en tiempo de ejecución** (`assertSugerenciaSinPoder`). Los tipos se
 *     borran al compilar y un adaptador con un `as` los esquiva; el pliegue no se esquiva, porque
 *     por él pasa todo historial, también el que venga de una restauración.
 *  4. **No hay camino de una sugerencia a ningún otro agregado.** El único destino posible del texto
 *     que propone una máquina es ser la respuesta a una de las 27 preguntas, y sólo si una persona
 *     ejecuta `aplicarSugerencia`. No existe una orden que convierta una sugerencia en una
 *     propuesta, en un voto, en una tarea ni en un peso.
 *
 * **Lo que esto no impide, dicho sin suavizar:** un texto puede contener la frase «apruébenlo». El
 * tipo no distingue una redacción de una orden, y ninguna regla de tipos podría. Lo que sí hay es
 * que ese texto no llega a ningún sitio salvo a un campo de un formulario, con la marca de que lo
 * escribió una máquina, y a alguien que puede borrarlo. La influencia por redacción es real y se
 * atiende por otra vía: la tasa **colectiva** de aceptación del final de este fichero.
 *
 * ═══ Consentimiento ═══
 *
 * Antes de que el texto de alguien salga hacia un tercero hay que pedírselo, diciendo **a dónde va y
 * qué se manda**. El destino se copia **por valor** dentro del evento de consentimiento —el mismo
 * patrón de las reglas congeladas de ADR-0025 y ADR-0051—, y el pliegue exige que el destino de cada
 * sugerencia coincida con esa copia. Cambiar de proveedor, o cambiar la frase que describe qué se
 * envía, **invalida** el consentimiento anterior: nadie consintió a eso.
 *
 * Si la respuesta es no, se degrada al modo sin IA sin penalización, y **no se vuelve a preguntar**
 * (`sePuedePedirConsentimiento`). La persona puede cambiar de idea por su cuenta; el sistema no
 * insiste.
 *
 * ═══ Procedencia sin vigilancia ═══
 *
 * `SugerenciaRecibida` lleva `actor: 'system'` y el pliegue lo **exige**. No es cosmético: si la
 * oferta de la máquina estuviera atada a una persona, el historial permitiría calcular cuántas
 * sugerencias rechaza cada quien, que es una métrica de actividad individual y está prohibida por
 * ADR-0040. Lo que queda registrado es que la sugerencia **existió** y, si alguien la aplicó, que la
 * aplicó —eso sí es un acto de una persona y tiene que ser suyo—. Una sugerencia no aplicada no
 * genera ningún evento: se sabe por ausencia. Años después se puede reconstruir qué escribió una
 * persona y qué le propuso una máquina, y no se puede reconstruir a quién le cae mal la máquina.
 */

import { toCanonicalJson } from '../canonical.js';
import { DomainError, InvalidIdError } from '../errors.js';
import { type Fraction, cmpFraction, ratio, THREE_QUARTERS } from '../fraction.js';
import { type Brand, ID_PATTERN, type Instant, type MemberId } from '../ids.js';
import { assertLedgerText, MAX_BODY_LENGTH } from '../workspace/text.js';
import type { ChainedEvent, ChainedLog } from '../workspace/chain.js';
import {
  type NumeroPregunta,
  type Pregunta,
  PREGUNTAS,
  PREGUNTAS_OBLIGATORIAS,
  esNumeroDePregunta,
} from './preguntas.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Identificadores
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Identificador opaco de un borrador. Uno por idea que alguien empieza a escribir. */
export type BorradorId = Brand<string, 'BorradorId'>;
/** Identificador opaco de una sugerencia. Lo asigna quien la registra, nunca el puerto. */
export type SugerenciaId = Brand<string, 'SugerenciaId'>;

const OPACO = '32 caracteres hexadecimales en minúscula';

export function borradorId(valor: string): BorradorId {
  if (!ID_PATTERN.test(valor)) throw new InvalidIdError('BorradorId', valor, OPACO);
  return valor as BorradorId;
}

export function sugerenciaId(valor: string): SugerenciaId {
  if (!ID_PATTERN.test(valor)) throw new InvalidIdError('SugerenciaId', valor, OPACO);
  return valor as SugerenciaId;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Errores propios
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Una sugerencia transporta algo que no es texto: un número, un veredicto, un identificador.
 *
 * Es el guardián de tiempo de ejecución de la capa 2. Si salta, no hay que «limpiar» la sugerencia:
 * hay que mirar qué adaptador la produjo, porque acaba de intentar decidir.
 */
export class SugerenciaConPoder extends DomainError {
  readonly campo: string;

  constructor(campo: string, detalle: string) {
    super(
      'AI_SUGGESTION_WITH_POWER',
      `la sugerencia lleva algo que no es texto en ${campo}: ${detalle}. Un puerto de IA propone ` +
        'palabras; no puntúa, no pesa, no aprueba y no nombra a nadie',
    );
    this.name = 'SugerenciaConPoder';
    this.campo = campo;
  }
}

/**
 * Iba a salir de la plataforma algo que identifica a alguien o ata el texto a su historial.
 *
 * El texto que escribe una persona puede revelar su posición política. Hacia un tercero viaja el
 * fragmento a procesar y nada más: ni quién lo escribió, ni de qué borrador salió, ni qué respondió
 * antes.
 */
export class FugaDeIdentidad extends DomainError {
  constructor(detalle: string) {
    super(
      'AI_IDENTITY_LEAK',
      `no sale de aquí: ${detalle}. Hacia un tercero viaja el fragmento a procesar, nunca la ` +
        'identidad de quien lo escribió ni su historial',
    );
    this.name = 'FugaDeIdentidad';
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El texto que una máquina puede proponer
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Texto propuesto por una máquina. Es lo **único** que una sugerencia puede llevar, junto con
 * números de pregunta.
 *
 * Va con marca nominal para que `Inocuo` pueda distinguirlo de un `string` cualquiera: sin la marca,
 * un `MemberId` —que también es `string`— pasaría el filtro, y con él pasaría la identidad de una
 * persona dentro de algo que se va a mostrar como sugerencia.
 */
export type TextoSugerido = Brand<string, 'TextoSugerido'>;

/** Tope de texto de una sugerencia. El mismo que el de un cuerpo del historial. */
export const MAX_TEXTO_SUGERIDO = MAX_BODY_LENGTH;

/** Constructor validador. Exige NFC y rango, como todo texto que puede acabar en el historial. */
export function textoSugerido(valor: string): TextoSugerido {
  assertLedgerText(valor, { field: 'texto sugerido', min: 1, max: MAX_TEXTO_SUGERIDO });
  return valor as TextoSugerido;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La barrera de tipos: `Inocuo`
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ¿El tipo `T` es incapaz de expresar una decisión o una mutación?
 *
 * Es una **lista blanca**, no una lista negra, y esa es toda la diferencia: sólo pasan
 * `TextoSugerido` y `NumeroPregunta`, más arreglos y objetos hechos de esos dos. Cualquier otra cosa
 * —`boolean`, `number`, `bigint`, `string` sin marcar, una función, `null`, `undefined`, un
 * identificador de otra marca— da `false`. Con lista negra habría que acordarse de prohibir cada
 * novedad; con lista blanca, la novedad se rechaza sola hasta que alguien la autorice por escrito.
 *
 * Por qué cada exclusión:
 *
 *  - `boolean` — un booleano en una respuesta de IA es un veredicto: aprobado, admisible, válido.
 *  - `number` — un número es un peso, una puntuación o un umbral. Los tres asignan poder.
 *  - `string` sin marca — sería la puerta por la que entran `MemberId`, `DecisionId` y `Hash`, que
 *    también son cadenas. Marcar el texto es lo que separa «una palabra» de «un nombre».
 *  - función — una función es una mutación esperando a que la llamen.
 *  - `undefined` y las uniones con `undefined` — un campo opcional obliga a leer el tipo dos veces
 *    para saber qué llega. Aquí no hay campos opcionales; ausencia se dice con una lista vacía.
 *
 * `NumeroPregunta` es la única excepción numérica y está acotada a 27 literales: no es una cantidad,
 * es la etiqueta de un campo del formulario. **Su límite, declarado:** en el tipo, `{ puntaje: 3 }` y
 * `{ pregunta: 3 }` son indistinguibles —los dos son un literal de 1 a 27—, así que la barrera de
 * tipos no cierra esa puerta. La cierra el guardián de tiempo de ejecución, que sólo admite un número
 * bajo un campo llamado `pregunta` (`CAMPO_NUMERICO_PERMITIDO`); y la cierra del todo el hecho de que
 * lo que acaba guardado en el historial es una lista plana de cadenas, donde un número no cabe.
 */
export type EsInocuo<T> = [T] extends [TextoSugerido]
  ? true
  : [T] extends [NumeroPregunta]
    ? true
    : [T] extends [string | number | bigint | boolean | symbol | null | undefined]
      ? false
      : [T] extends [(...args: never[]) => unknown]
        ? false
        : [T] extends [readonly (infer E)[]]
          ? EsInocuo<E>
          : [T] extends [object]
            ? false extends { [K in keyof T]-?: EsInocuo<T[K]> }[keyof T]
              ? false
              : true
            : false;

/**
 * `T` si es inocuo, `never` si no.
 *
 * Puesto como **tipo de un campo obligatorio**, `never` hace la sugerencia inconstruible: no existe
 * ningún valor de tipo `never`, así que ninguna implementación del puerto compila. Es la forma más
 * simple de decir «esto no se puede escribir» y la que produce un error legible en el sitio exacto.
 */
export type Inocuo<T> = EsInocuo<T> extends true ? T : never;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Operaciones: las que hay y las que nunca puede haber
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Lo único que se le puede pedir a un modelo. Siete, y ninguna decide.
 *
 * Todas comparten forma: entra un fragmento de texto, sale texto que una persona puede tomar, editar
 * o tirar. Ninguna lee el historial, ninguna escribe en él y ninguna sabe de quién es el texto.
 */
export type OperacionIA =
  | 'estructurar'
  | 'resumir'
  | 'buscar_parecidos'
  | 'senalar_contradicciones'
  | 'proponer_alternativas'
  | 'partir_en_tareas'
  | 'explicar_una_regla';

export const OPERACIONES: readonly OperacionIA[] = [
  'estructurar',
  'resumir',
  'buscar_parecidos',
  'senalar_contradicciones',
  'proponer_alternativas',
  'partir_en_tareas',
  'explicar_una_regla',
];

/** Cómo se le dice a la gente cada operación. Sin jerga (ADR-0041): son siete frases, no siete APIs. */
export const TITULO_DE_OPERACION: Readonly<Record<OperacionIA, string>> = {
  estructurar: 'Ordenar lo que escribiste',
  resumir: 'Resumirlo en pocas líneas',
  buscar_parecidos: 'Buscar cosas parecidas que ya se intentaron',
  senalar_contradicciones: 'Señalar dos cosas tuyas que no encajan',
  proponer_alternativas: 'Proponer otras maneras de hacerlo',
  partir_en_tareas: 'Partirlo en tareas',
  explicar_una_regla: 'Explicar una regla del sistema',
};

/**
 * Lo que este puerto **nunca** debe exponer. No es una lista de deseos: es la frontera del principio 6.
 *
 * Están aquí con su motivo porque la próxima persona que amplíe el puerto va a tener una razón
 * plausible para añadir una de las cuatro, y la razón plausible es exactamente el mecanismo por el
 * que una herramienta de apoyo se convierte en la que manda.
 */
export type OperacionProhibida =
  'puntuar_propuestas' | 'moderar' | 'evaluar_impacto' | 'fusionar_borradores';

export interface Prohibicion {
  readonly operacion: OperacionProhibida;
  readonly porQue: string;
}

export const OPERACIONES_PROHIBIDAS: readonly Prohibicion[] = [
  {
    operacion: 'puntuar_propuestas',
    porQue:
      'Una puntuación es un orden, y un orden es una decisión tomada antes de la votación: lo que ' +
      'queda arriba se lee más y se vota más. Además sería una calificación de lo que escribió una ' +
      'persona concreta, que es lo que ADR-0039 prohíbe cuando prohíbe la reputación.',
  },
  {
    operacion: 'moderar',
    porQue:
      'Ocultar o marcar un aporte es quitarle la voz a alguien, y el derecho de voz es inderogable ' +
      '(ADR-0040). Quién puede callar a quién es la competencia más política que existe: la ejerce ' +
      'un cuerpo con mandato, revocable y apelable, no un modelo cuyo criterio nadie puede leer.',
  },
  {
    operacion: 'evaluar_impacto',
    porQue:
      'Decir «esto va a servir» o «esto no» es decidir el fondo del asunto con voz de oráculo. El ' +
      'impacto lo evalúan las personas afectadas, después, contra lo que ellas mismas escribieron ' +
      'en las preguntas 18 y 25. Una predicción de máquina antes del hecho es un veredicto ' +
      'disfrazado de pronóstico.',
  },
  {
    operacion: 'fusionar_borradores',
    porQue:
      'Fusionar dos borradores es elegir qué parte de cada quien sobrevive, y eso hace desaparecer ' +
      'la posición que perdió sin que nadie la haya retirado. Dos borradores parecidos se resuelven ' +
      'con una conversación entre quienes los escribieron; la máquina, como mucho, avisa de que se ' +
      'parecen (`buscar_parecidos`).',
  },
];

/** ¿Este nombre de operación es uno de los cuatro prohibidos? */
export function esOperacionProhibida(nombre: string): nombre is OperacionProhibida {
  return OPERACIONES_PROHIBIDAS.some((p) => p.operacion === nombre);
}

/** ¿Este nombre es una de las siete operaciones permitidas? */
export function esOperacionIA(nombre: string): nombre is OperacionIA {
  return OPERACIONES.some((o) => o === nombre);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lo que devuelve el puerto
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface TramoSugerido {
  readonly pregunta: NumeroPregunta;
  readonly texto: TextoSugerido;
}

/** `estructurar`: reparte un texto largo entre las preguntas a las que parece responder. */
export interface EstructuraSugerida {
  readonly tramos: readonly TramoSugerido[];
}

/** `resumir`. */
export interface ResumenSugerido {
  readonly resumen: TextoSugerido;
}

export interface ParecidoSugerido {
  readonly texto: TextoSugerido;
  readonly porQue: TextoSugerido;
}

/**
 * `buscar_parecidos`: devuelve **textos**, no identificadores.
 *
 * Quien llama ya sabe qué textos le pasó para comparar; volver a atarlos a una iniciativa es trabajo
 * suyo. Si el puerto devolviera identificadores estaría señalando cosas del sistema, y señalar es el
 * primer paso de decidir.
 */
export interface ParecidosSugeridos {
  readonly parecidos: readonly ParecidoSugerido[];
}

export interface TensionSugerida {
  readonly unaParte: TextoSugerido;
  readonly otraParte: TextoSugerido;
  readonly porQue: TextoSugerido;
}

/** `senalar_contradicciones`: dos cosas que quien escribe dijo y que no encajan. Sin veredicto. */
export interface ContradiccionesSugeridas {
  readonly tensiones: readonly TensionSugerida[];
}

/** `proponer_alternativas`. */
export interface AlternativasSugeridas {
  readonly alternativas: readonly TextoSugerido[];
}

/**
 * `partir_en_tareas`: frases, no tareas.
 *
 * Una `Task` del sistema tiene responsable, plazo y consecuencias. Aquí salen frases que alguien
 * puede copiar al crear tareas de verdad, con las órdenes de `workspace/initiative.ts` y con su
 * nombre encima. El puerto no crea nada.
 */
export interface TareasSugeridas {
  readonly tareas: readonly TextoSugerido[];
}

/** `explicar_una_regla`: dice qué hace una regla; no dice si está bien ni propone cambiarla. */
export interface ExplicacionSugerida {
  readonly explicacion: TextoSugerido;
}

/**
 * Lo único que un puerto de IA puede devolver.
 *
 * Sin identificadores, sin instantes, sin autoría y sin ninguna forma de referirse a nada del
 * sistema. `clase` es un literal cerrado: no existe `'decision'`, no existe `'cambio'`, y añadir uno
 * exigiría cambiar este tipo, que es exactamente la conversación que debe ocurrir.
 */
export interface Sugerencia<C> {
  readonly clase: 'sugerencia';
  readonly operacion: OperacionIA;
  /** `never` —y por tanto inconstruible— si `C` puede transportar una decisión. Ver `Inocuo`. */
  readonly contenido: Inocuo<C>;
}

/**
 * Una sugerencia vista **sin su genérico**, para quien sólo necesita registrarla.
 *
 * Toda `Sugerencia<C>` encaja aquí, y aquí el contenido es `unknown`: es exactamente lo que sabe
 * quien la mete en el historial, que no interpreta la forma sino que la aplana a texto y le pasa el
 * guardián de tiempo de ejecución. No debilita nada —la barrera de tipos actúa en el borde del
 * puerto, que es donde el modelo produce— y evita que el compilador tenga que deducir `C` a través de
 * un tipo condicional, cosa que no puede hacer y que en algún punto acaba en «instanciación
 * excesivamente profunda».
 */
export interface SugerenciaCualquiera {
  readonly clase: 'sugerencia';
  readonly operacion: OperacionIA;
  readonly contenido: unknown;
}

/**
 * Lo que sale de la plataforma hacia un tercero. **Sólo esto.**
 *
 * No hay aquí un `borradorId`, ni un `MemberId`, ni las respuestas anteriores, ni el número de la
 * pregunta —que ya diría bastante—. `conQueComparar` es para `buscar_parecidos` y son textos sueltos
 * de la memoria pública, sin la etiqueta de quién los escribió.
 *
 * **Límite declarado, y es el punto flojo de todo este diseño.** `conQueComparar` transporta texto
 * que escribió **otra gente**. El dominio comprueba que no lleve identificadores, y eso es todo lo
 * que puede comprobar: **no puede saber si esos textos eran públicos**, porque no conoce el estado de
 * publicación de nada. La obligación de pasar sólo material ya público es del adaptador, y aquí queda
 * escrita para que quien lo implemente no descubra la regla por su cuenta. Un despliegue que no pueda
 * garantizarlo debe dejar `conQueComparar` vacío: `buscar_parecidos` sin corpus devuelve poco, y
 * devolver poco es mejor que exportar lo que alguien escribió sin saberlo.
 */
export interface PeticionIA {
  readonly operacion: OperacionIA;
  readonly fragmento: string;
  readonly conQueComparar: readonly string[];
}

/**
 * El puerto. Siete operaciones, siete métodos, todos devuelven una sugerencia.
 *
 * Es una **interfaz**, no una implementación: un modelo de lenguaje es I/O y no es determinista, y
 * ninguna de las dos cosas puede vivir en `packages/domain` (ADR-0001). Aquí está la forma del hueco;
 * el adaptador vive en `services/api`.
 */
export interface AIAssistantPort {
  estructurar(peticion: PeticionIA): Promise<Sugerencia<EstructuraSugerida>>;
  resumir(peticion: PeticionIA): Promise<Sugerencia<ResumenSugerido>>;
  buscarParecidos(peticion: PeticionIA): Promise<Sugerencia<ParecidosSugeridos>>;
  senalarContradicciones(peticion: PeticionIA): Promise<Sugerencia<ContradiccionesSugeridas>>;
  proponerAlternativas(peticion: PeticionIA): Promise<Sugerencia<AlternativasSugeridas>>;
  partirEnTareas(peticion: PeticionIA): Promise<Sugerencia<TareasSugeridas>>;
  explicarUnaRegla(peticion: PeticionIA): Promise<Sugerencia<ExplicacionSugerida>>;
}

/**
 * El puerto **o su ausencia**. Este es el tipo que debe circular por la aplicación.
 *
 * Que la ausencia esté en el tipo y no en una variable de entorno es lo que hace que el modo sin IA
 * no sea un caso de error: quien recibe un `PuertoDeIA` está obligado por el compilador a tratar el
 * `undefined`, y la única forma correcta de tratarlo es el modo estructural de `cierre.ts`.
 */
export type PuertoDeIA = AIAssistantPort | undefined;

/**
 * Qué método atiende cada operación. Total sobre `OperacionIA`: añadir una operación sin método
 * rompe la compilación aquí, que es donde hay que enterarse.
 */
export const METODO_DE_OPERACION: Readonly<Record<OperacionIA, keyof AIAssistantPort>> = {
  estructurar: 'estructurar',
  resumir: 'resumir',
  buscar_parecidos: 'buscarParecidos',
  senalar_contradicciones: 'senalarContradicciones',
  proponer_alternativas: 'proponerAlternativas',
  partir_en_tareas: 'partirEnTareas',
  explicar_una_regla: 'explicarUnaRegla',
};

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Guardianes de tiempo de ejecución
// ═════════════════════════════════════════════════════════════════════════════════════════════

function esObjetoPlano(valor: unknown): valor is Readonly<Record<string, unknown>> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false;
  const proto: unknown = Object.getPrototypeOf(valor);
  return proto === Object.prototype || proto === null;
}

/**
 * Recorre el contenido de una sugerencia y revienta ante lo que no sea texto o número de pregunta.
 *
 * Es la capa 3: la que sigue en pie cuando alguien esquiva los tipos con un `as`. Corre en el
 * pliegue, no sólo en la orden, porque por el pliegue pasa también el historial que alguien traiga
 * de fuera.
 */
/**
 * El único nombre de campo bajo el que se admite un número.
 *
 * Es lo que cierra el agujero que el tipo no puede cerrar. `Inocuo` deja pasar `NumeroPregunta` —hace
 * falta para `TramoSugerido`—, y en el tipo nada distingue `{ pregunta: 3 }` de `{ puntaje: 3 }`:
 * ambos son un literal de 1 a 27. En tiempo de ejecución sí se distinguen, porque el campo tiene
 * nombre. Regla: **el único número que una sugerencia puede llevar es un número de pregunta, y tiene
 * que llamarse `pregunta`.** Un contenido futuro que necesite otro número tendrá que discutirse, que
 * es justamente lo que se quiere.
 */
export const CAMPO_NUMERICO_PERMITIDO = 'pregunta';

/**
 * Recorre el contenido de una sugerencia y revienta ante lo que no sea texto o número de pregunta.
 *
 * Es la capa 3: la que sigue en pie cuando alguien esquiva los tipos con un `as`, y la que atrapa lo
 * que los tipos no ven —un número de pregunta usado como puntuación—. Corre donde la salida del
 * puerto entra al sistema (`registrarSugerencia`), y lo que queda guardado después es una lista plana
 * de cadenas, que el pliegue vuelve a comprobar.
 */
export function assertSugerenciaSinPoder(
  valor: unknown,
  campo = 'contenido',
  clave?: string,
): void {
  if (typeof valor === 'string') return;
  if (typeof valor === 'number') {
    if (clave !== CAMPO_NUMERICO_PERMITIDO) {
      throw new SugerenciaConPoder(
        campo,
        `el único número que cabe en una sugerencia es el de una pregunta, y tiene que llamarse ` +
          `«${CAMPO_NUMERICO_PERMITIDO}»; «${clave ?? '(sin nombre)'}» sería un peso, una nota o ` +
          'un umbral',
      );
    }
    if (!esNumeroDePregunta(valor)) {
      throw new SugerenciaConPoder(
        campo,
        `${String(valor)} no es un número de pregunta: el formulario tiene 27`,
      );
    }
    return;
  }
  if (Array.isArray(valor)) {
    const lista: readonly unknown[] = valor;
    lista.forEach((elemento, i) => {
      assertSugerenciaSinPoder(elemento, `${campo}[${String(i)}]`, clave);
    });
    return;
  }
  if (esObjetoPlano(valor)) {
    for (const nombre of Object.keys(valor).sort()) {
      assertSugerenciaSinPoder(valor[nombre], `${campo}.${nombre}`, nombre);
    }
    return;
  }
  throw new SugerenciaConPoder(campo, `${typeof valor} no es texto ni número de pregunta`);
}

/** Todas las cadenas que hay dentro de un valor, en orden de recorrido. */
export function textosDe(valor: unknown): readonly string[] {
  if (typeof valor === 'string') return [valor];
  if (Array.isArray(valor)) {
    const lista: readonly unknown[] = valor;
    return lista.flatMap((elemento) => textosDe(elemento));
  }
  if (esObjetoPlano(valor)) {
    return Object.keys(valor)
      .sort()
      .flatMap((clave) => textosDe(valor[clave]));
  }
  return [];
}

/**
 * Rastro de identificador: 32 caracteres hexadecimales seguidos, en cualquier parte de un texto.
 *
 * Cubre también los hashes de 64, que contienen 32. No está anclado a propósito: lo que se busca es
 * un identificador **incrustado** en la prosa, que es como se filtraría de verdad.
 */
const RASTRO_DE_IDENTIFICADOR = /[0-9a-f]{32}/u;

/**
 * Exige que hacia el tercero sólo vaya el fragmento a procesar.
 *
 * Dos comprobaciones distintas y hacen falta las dos: la genérica —cualquier cosa con forma de
 * identificador opaco— y la nominal, contra los identificadores que este borrador concreto conoce.
 * La primera atrapa el descuido; la segunda atrapa el identificador con formato raro que alguien
 * concatenó a mano.
 */
export function assertPeticionSinIdentidad(
  peticion: PeticionIA,
  identidadesConocidas: readonly string[] = [],
): void {
  const piezas = [peticion.fragmento, ...peticion.conQueComparar];
  for (const pieza of piezas) {
    const rastro = RASTRO_DE_IDENTIFICADOR.exec(pieza);
    if (rastro !== null) {
      throw new FugaDeIdentidad(
        'el texto que iba a salir contiene algo con forma de identificador del sistema',
      );
    }
    for (const identidad of identidadesConocidas) {
      if (identidad !== '' && pieza.includes(identidad)) {
        throw new FugaDeIdentidad(
          'el texto que iba a salir contiene un identificador de este mismo borrador',
        );
      }
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Respuestas
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Tope de líneas de una respuesta en lista. Una lista de 30 causas ya no es una lista, es un ensayo. */
export const MAX_LINEAS = 30;

/**
 * Lo que alguien contesta a una pregunta.
 *
 * `todavia_no_se` es una respuesta de primera clase y vale en las 27 (§3.1). No es un hueco por
 * descuido: es alguien diciendo que no lo sabe, que es información. Se guarda como hueco para que
 * más tarde se convierta en tarea, y en la 1 y la 11 —las dos obligatorias— impide cerrar.
 */
export type Respuesta =
  | { readonly forma: 'frase'; readonly texto: string }
  | { readonly forma: 'lineas'; readonly lineas: readonly string[] }
  | { readonly forma: 'por_linea'; readonly porLinea: readonly string[] }
  | { readonly forma: 'todavia_no_se' };

export type FormaDeRespuestaDada = Respuesta['forma'];

export const FORMAS_DE_RESPUESTA: readonly FormaDeRespuestaDada[] = [
  'frase',
  'lineas',
  'por_linea',
  'todavia_no_se',
];

/**
 * ¿Hay contenido? `todavia_no_se` y las listas vacías no cuentan.
 *
 * Es la función que decide si el borrador se puede cerrar, así que su severidad importa: una cadena
 * de espacios no es una respuesta a «¿qué está pasando que no debería estar pasando?».
 */
export function estaRespondida(respuesta: Respuesta): boolean {
  switch (respuesta.forma) {
    case 'todavia_no_se':
      return false;
    case 'frase':
      return respuesta.texto.trim() !== '';
    case 'lineas':
      return respuesta.lineas.some((l) => l.trim() !== '');
    case 'por_linea':
      return respuesta.porLinea.length > 0 && respuesta.porLinea.some((l) => l.trim() !== '');
  }
}

/** Los textos que lleva una respuesta, para compararla con lo que una máquina propuso. */
export function textosDeRespuesta(respuesta: Respuesta): readonly string[] {
  switch (respuesta.forma) {
    case 'todavia_no_se':
      return [];
    case 'frase':
      return [respuesta.texto];
    case 'lineas':
      return respuesta.lineas;
    case 'por_linea':
      return respuesta.porLinea;
  }
}

/**
 * ¿La forma de la respuesta es la que pide la pregunta?
 *
 * `todavia_no_se` encaja con todas. Lo demás tiene que coincidir: contestar la 6 —«una causa por
 * línea»— con una frase suelta rompe la 7, que enumera esas líneas.
 */
export function formaEncaja(pregunta: Pregunta, respuesta: Respuesta): boolean {
  return respuesta.forma === 'todavia_no_se' || respuesta.forma === pregunta.forma;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Consentimiento
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A dónde va el texto y qué se manda, en las palabras con que se le dice a la persona.
 *
 * Va **por valor** dentro del evento de consentimiento y dentro de cada sugerencia, y el pliegue
 * exige que las dos copias coincidan. Cambiar de proveedor no es un detalle de operación: es cambiar
 * a quién le estás dando el texto de alguien, y nadie consintió a eso.
 */
export interface DestinoIA {
  /** «a dónde va»: el nombre del servicio, dicho como se le diría a alguien en una conversación. */
  readonly aDondeVa: string;
  /** «qué se manda»: en una frase, sin tecnicismos. */
  readonly queSeManda: string;
  /** «qué no se manda»: la otra mitad, que es la que hace creíble a la primera. */
  readonly queNoSeManda: string;
  /** Si el modelo corre en la misma máquina que la plataforma. Cambia la respuesta de mucha gente. */
  readonly enLaMismaMaquina: boolean;
}

export interface DecisionDeConsentimiento {
  readonly concedido: boolean;
  /** El destino tal como se le describió a la persona cuando dijo que sí o que no. */
  readonly destino: DestinoIA;
  readonly decididoEn: Instant;
  readonly seq: number;
}

function canonico(valor: unknown): string {
  return JSON.stringify(toCanonicalJson(valor));
}

/**
 * ¿Son el mismo destino?
 *
 * Se compara la **preimagen canónica entera**, no campo a campo: si mañana alguien añade un campo a
 * `DestinoIA` —la región donde se procesa, el plazo de retención—, queda cubierto sin que nadie
 * tenga que acordarse de compararlo. Es el mismo argumento de `canonicalEquals` en la constitución.
 */
export function mismoDestino(a: DestinoIA, b: DestinoIA): boolean {
  return canonico(a) === canonico(b);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Eventos
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Una sugerencia ya dentro del historial: con identificador, con alcance y con destino.
 *
 * `textos` es el aplanado de todo lo que la máquina propuso. Está aquí, y no la forma estructurada,
 * porque el pliegue tiene que poder comprobar que la respuesta que alguien dice haber tomado de esta
 * sugerencia **estaba** en esta sugerencia. Sin ese cotejo, «lo sugirió la máquina» sería una
 * etiqueta que cualquiera se pone, y la procedencia dejaría de valer para lo único que sirve:
 * distinguir, años después, lo que escribió una persona de lo que le propuso un modelo.
 */
export interface SugerenciaRegistrada {
  readonly sugerenciaId: SugerenciaId;
  readonly operacion: OperacionIA;
  /** A qué pregunta apunta. `undefined` cuando mira el borrador entero, como `estructurar`. */
  readonly pregunta: NumeroPregunta | undefined;
  readonly textos: readonly string[];
  readonly destino: DestinoIA;
}

export type AssistantPayload =
  | { readonly type: 'BorradorAbierto' }
  | {
      readonly type: 'RespuestaEscrita';
      readonly pregunta: NumeroPregunta;
      readonly respuesta: Respuesta;
    }
  /**
   * La máquina propuso algo. `actor` es `'system'` y el pliegue lo exige: atarlo a una persona
   * permitiría contar sus rechazos, y eso es una métrica de actividad individual (ADR-0040).
   */
  | { readonly type: 'SugerenciaRecibida'; readonly sugerencia: SugerenciaRegistrada }
  /** Una persona tomó una sugerencia. `actor` es esa persona: el acto es suyo y la autoría también. */
  | {
      readonly type: 'SugerenciaAplicada';
      readonly sugerenciaId: SugerenciaId;
      readonly pregunta: NumeroPregunta;
      readonly respuesta: Respuesta;
    }
  | {
      readonly type: 'ConsentimientoDecidido';
      readonly concedido: boolean;
      readonly destino: DestinoIA;
    }
  | { readonly type: 'BorradorCerrado' };

export type AssistantEventType = AssistantPayload['type'];

export const ASSISTANT_EVENT_TYPES: readonly AssistantEventType[] = [
  'BorradorAbierto',
  'RespuestaEscrita',
  'SugerenciaRecibida',
  'SugerenciaAplicada',
  'ConsentimientoDecidido',
  'BorradorCerrado',
];

export type AssistantEvent = ChainedEvent<AssistantPayload>;
export type AssistantLog = ChainedLog<AssistantPayload>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Estado
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** De dónde salió el texto de una respuesta. Es la procedencia, y no se borra nunca. */
export type OrigenDeRespuesta = 'mano' | 'sugerencia';

export const ORIGENES: readonly OrigenDeRespuesta[] = ['mano', 'sugerencia'];

/**
 * Una versión de una respuesta. Nada se pisa: se apila.
 *
 * Guardar todas las versiones —y no sólo la última— es lo que permite reconstruir años después qué
 * escribió una persona y qué le propuso una máquina, incluso si la respuesta final ya no se parece a
 * ninguna de las dos.
 */
export interface VersionDeRespuesta {
  readonly pregunta: NumeroPregunta;
  readonly respuesta: Respuesta;
  readonly origen: OrigenDeRespuesta;
  /** La sugerencia de la que se tomó, si `origen` es `sugerencia`. */
  readonly sugerenciaId: SugerenciaId | undefined;
  readonly escritaEn: Instant;
  readonly seq: number;
}

export type EstadoBorrador = 'inexistente' | 'redactando' | 'cerrado';

export interface AssistantState {
  readonly borradorId: BorradorId;
  readonly existe: boolean;
  /** Quien lo abrió. Nadie más escribe en él. */
  readonly autor: MemberId | undefined;
  readonly estado: EstadoBorrador;
  /** Toda versión de toda respuesta, en orden de escritura. */
  readonly historial: readonly VersionDeRespuesta[];
  /** Las sugerencias que existieron, en orden de llegada. Aplicadas o no. */
  readonly sugerencias: readonly SugerenciaRegistrada[];
  /** Cuáles se aplicaron. Lo no aplicado se sabe por ausencia: no hay evento de rechazo. */
  readonly aplicadas: readonly SugerenciaId[];
  readonly consentimiento: DecisionDeConsentimiento | undefined;
  readonly cerradoEn: Instant | undefined;
  readonly lastSeq: number;
}

export function initialAssistantState(id: BorradorId): AssistantState {
  return {
    borradorId: id,
    existe: false,
    autor: undefined,
    estado: 'inexistente',
    historial: [],
    sugerencias: [],
    aplicadas: [],
    consentimiento: undefined,
    cerradoEn: undefined,
    lastSeq: 0,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Proyecciones
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** La versión vigente de una respuesta: la última escrita. */
export function respuestaDe(
  estado: AssistantState,
  numero: NumeroPregunta,
): VersionDeRespuesta | undefined {
  let vigente: VersionDeRespuesta | undefined;
  for (const version of estado.historial) {
    if (version.pregunta === numero) vigente = version;
  }
  return vigente;
}

/** Toda la historia de una respuesta, de la primera versión a la última. */
export function historialDeRespuesta(
  estado: AssistantState,
  numero: NumeroPregunta,
): readonly VersionDeRespuesta[] {
  return estado.historial.filter((v) => v.pregunta === numero);
}

/** Por qué falta una respuesta. Los dos motivos se tratan igual para cerrar y distinto para avisar. */
export type MotivoDeHueco = 'sin_responder' | 'todavia_no_se';

export interface Hueco {
  readonly pregunta: NumeroPregunta;
  readonly motivo: MotivoDeHueco;
  /** Si el hueco impide cerrar el borrador. Sólo la 1 y la 11. */
  readonly bloquea: boolean;
}

/**
 * Las preguntas sin responder, con el motivo y con si impiden cerrar.
 *
 * Los huecos son el producto secundario más útil del formulario: §3.1 dice que «todavía no sé» se
 * guarda «como hueco que genera tarea posterior». Aquí se **listan**; convertirlos en tareas es cosa
 * de `workspace/initiative.ts` y de una persona que lo ordene.
 */
export function huecos(estado: AssistantState): readonly Hueco[] {
  const lista: Hueco[] = [];
  for (const p of PREGUNTAS) {
    const version = respuestaDe(estado, p.numero);
    if (version !== undefined && estaRespondida(version.respuesta)) continue;
    const motivo: MotivoDeHueco =
      version?.respuesta.forma === 'todavia_no_se' ? 'todavia_no_se' : 'sin_responder';
    lista.push({ pregunta: p.numero, motivo, bloquea: p.obligatoria });
  }
  return lista;
}

/**
 * Una respuesta «por cada línea» que dejó de cuadrar con la lista que enumeraba.
 *
 * Pasa con la única pregunta que tiene esa forma —la 7, «(por cada causa)»—: se responde con tantas
 * casillas como causas hay en la 6, y después alguien reescribe la 6 con más causas o con menos. El
 * pliegue comprueba la alineación **al escribir**, no para siempre, y no puede hacer otra cosa: la
 * alternativa sería impedir corregir la 6, o recortar la 7 por cuenta propia.
 *
 * Ninguna de las dos vale. Impedir la corrección castiga a quien está pensando, que es la persona
 * para la que existe este formulario; y recortar la 7 sería **la máquina editando a la persona**, que
 * es exactamente lo que este agregado no hace en ningún sitio. Así que se **muestra**: §3.1 dice que
 * el sistema no corrige, y esto es no corregir y aun así avisar.
 */
export interface Desajuste {
  readonly pregunta: NumeroPregunta;
  /** La pregunta cuyas líneas enumeraba. */
  readonly deLaPregunta: NumeroPregunta;
  readonly tiene: number;
  readonly deberiaTener: number;
}

function cuantasLineas(estado: AssistantState, numero: NumeroPregunta): number {
  const version = respuestaDe(estado, numero);
  if (version === undefined) return 0;
  return textosDeRespuesta(version.respuesta).filter((l) => l.trim() !== '').length;
}

/** Las respuestas «por cada línea» que ya no cuadran. Vacío en un borrador coherente. */
export function desajustes(estado: AssistantState): readonly Desajuste[] {
  const salida: Desajuste[] = [];
  for (const p of PREGUNTAS) {
    const origen = p.porCadaLineaDe;
    if (origen === undefined) continue;
    const version = respuestaDe(estado, p.numero);
    if (version?.respuesta.forma !== 'por_linea') continue;
    const tiene = version.respuesta.porLinea.length;
    const deberiaTener = cuantasLineas(estado, origen);
    if (tiene !== deberiaTener) {
      salida.push({ pregunta: p.numero, deLaPregunta: origen, tiene, deberiaTener });
    }
  }
  return salida;
}

/** Las obligatorias que faltan. Vacío significa que el borrador se puede cerrar. */
export function faltanObligatorias(estado: AssistantState): readonly NumeroPregunta[] {
  return PREGUNTAS_OBLIGATORIAS.filter((numero) => {
    const version = respuestaDe(estado, numero);
    return version === undefined || !estaRespondida(version.respuesta);
  });
}

/**
 * ¿Se puede cerrar?
 *
 * Dos condiciones y nada más: que el borrador esté abierto y que la 1 y la 11 estén respondidas. Las
 * otras 25 pueden estar en blanco, y un borrador con 25 huecos declarados es mejor que un borrador
 * abandonado con 27.
 */
export function puedeCerrarse(estado: AssistantState): boolean {
  return estado.estado === 'redactando' && faltanObligatorias(estado).length === 0;
}

/** Qué escribió una persona y qué le propuso una máquina, pregunta por pregunta. */
export interface ProcedenciaDeRespuesta {
  readonly pregunta: NumeroPregunta;
  readonly origen: OrigenDeRespuesta;
  readonly sugerenciaId: SugerenciaId | undefined;
  readonly escritaEn: Instant;
  readonly seq: number;
  /** Cuántas veces se reescribió antes de quedar así. */
  readonly versiones: number;
}

/**
 * La procedencia de lo que hay ahora, en orden de pregunta.
 *
 * Es la respuesta a «años después, ¿qué de esto lo escribió una persona?». Mira sólo la versión
 * vigente; para la historia entera está `historialDeRespuesta`.
 */
export function procedencia(estado: AssistantState): readonly ProcedenciaDeRespuesta[] {
  const salida: ProcedenciaDeRespuesta[] = [];
  for (const p of PREGUNTAS) {
    const version = respuestaDe(estado, p.numero);
    if (version === undefined) continue;
    salida.push({
      pregunta: p.numero,
      origen: version.origen,
      sugerenciaId: version.sugerenciaId,
      escritaEn: version.escritaEn,
      seq: version.seq,
      versiones: historialDeRespuesta(estado, p.numero).length,
    });
  }
  return salida;
}

/** La sugerencia con ese identificador, si existió. */
export function sugerenciaRegistrada(
  estado: AssistantState,
  id: SugerenciaId,
): SugerenciaRegistrada | undefined {
  return estado.sugerencias.find((s) => s.sugerenciaId === id);
}

export function fueAplicada(estado: AssistantState, id: SugerenciaId): boolean {
  return estado.aplicadas.includes(id);
}

/**
 * ¿El consentimiento vigente cubre este destino?
 *
 * Tres condiciones y hacen falta las tres: que se haya decidido, que la decisión fuera que sí, y que
 * el destino sea **exactamente** el que se describió. Sin la tercera, cambiar de proveedor heredaría
 * un consentimiento que nadie dio.
 */
export function consentimientoCubre(estado: AssistantState, destino: DestinoIA): boolean {
  const decision = estado.consentimiento;
  if (decision === undefined) return false;
  return decision.concedido && mismoDestino(decision.destino, destino);
}

/**
 * ¿El sistema puede pedir consentimiento?
 *
 * Deja de poder en cuanto alguien dice que no, y no vuelve a poder por sí solo: eso es «sin
 * insistir». Que la persona cambie de idea sigue siendo posible —es un acto suyo, un
 * `ConsentimientoDecidido` que ella ordena—, pero la iniciativa ya no es del sistema.
 */
export function sePuedePedirConsentimiento(estado: AssistantState): boolean {
  const decision = estado.consentimiento;
  return decision === undefined || decision.concedido;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La tasa de aceptación, medida sobre el colectivo y jamás sobre una persona
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Cuántas sugerencias existieron en un borrador y cuántas se aplicaron. **Sin identidad.**
 *
 * ═══ Por qué esto se mide, y por qué se mide así ═══
 *
 * El riesgo es real y no lo resuelve el principio 6 por sí solo: una IA que «sólo sugiere» pero cuyas
 * sugerencias se aceptan casi siempre **gobierna de hecho**. Quien acepta no está decidiendo, está
 * firmando. Hay que verlo, y para verlo hay que contar.
 *
 * Lo que **no** se hace es contarlo por persona. «Fricción adaptativa si un usuario acepta más del
 * 75 %» es, con otro nombre, una métrica de actividad individual, y ADR-0040 la prohíbe: mide a la
 * gente, produce un perfil de quién es «dependiente de la máquina» y ese perfil, una vez existe, se
 * usa para otra cosa. Además castigaría precisamente a quien más ayuda necesita.
 *
 * Se mide sobre el **colectivo** y la fricción, si se activa, se activa **para todo el mundo por
 * igual**: si la comunidad entera está aceptando casi todo lo que propone la máquina, el problema es
 * de la máquina —o del diseño de la interfaz—, no de una persona.
 *
 * ═══ Dónde debería vivir esto ═══
 *
 * En `packages/metrics`, como sexta métrica de salud, junto a las cinco que ya están: es exactamente
 * su forma —entrada ya proyectada, sin identidad, salida agregada con umbral en fracción exacta— y
 * ese paquete ya tiene el sellado que revienta si una identidad se cuela. Aquí queda sólo el
 * **conteo por borrador**, que es el dato crudo que aquel paquete consumiría, y el umbral, porque es
 * una regla del asistente y no una métrica. Ver el ADR-0052 §(f) para la firma exacta que habría que
 * añadir allí.
 */
export interface ConteoDeSugerencias {
  readonly ofrecidas: number;
  readonly aplicadas: number;
}

/** El conteo de un borrador. No lleva ni el `borradorId` ni el autor: no hace falta y estorbaría. */
export function conteoDeSugerencias(estado: AssistantState): ConteoDeSugerencias {
  return { ofrecidas: estado.sugerencias.length, aplicadas: estado.aplicadas.length };
}

/**
 * A partir de cuánta aceptación colectiva se enciende la fricción. Tres cuartos.
 *
 * El número viene de la propuesta externa que originó esta pieza; lo que cambia es **sobre qué se
 * aplica**. Es una fracción exacta y se compara por multiplicación cruzada (ADR-0027) porque tiene
 * consecuencia: 3 de 4 tiene que ser 3 de 4, no 0,7499999999999999.
 */
export const UMBRAL_DE_FRICCION: Fraction = THREE_QUARTERS;

/**
 * Cuántos borradores hacen falta para publicar la tasa.
 *
 * Con dos borradores, «el colectivo acepta el 100 %» es una frase sobre dos personas. El mínimo es el
 * mismo argumento de k-anonimato que usan las métricas de salud, aplicado a la unidad que aquí se
 * agrega.
 */
export const MINIMO_DE_BORRADORES = 5;

export type TasaColectiva =
  | { readonly hayDatos: false; readonly borradores: number; readonly porQueNo: string }
  | {
      readonly hayDatos: true;
      readonly borradores: number;
      readonly ofrecidas: number;
      readonly aplicadas: number;
      readonly tasa: Fraction;
      /** Si toca frenar. Para **todo el mundo por igual**; nunca para una persona en concreto. */
      readonly enFriccion: boolean;
    };

/**
 * La tasa de aceptación del colectivo.
 *
 * Recibe conteos anónimos —ni un identificador en la entrada— y devuelve una fracción exacta. No hay
 * forma de llamarla con una persona, porque `ConteoDeSugerencias` no tiene dónde ponerla.
 */
export function tasaDeAceptacionColectiva(conteos: readonly ConteoDeSugerencias[]): TasaColectiva {
  if (conteos.length < MINIMO_DE_BORRADORES) {
    return {
      hayDatos: false,
      borradores: conteos.length,
      porQueNo:
        `hacen falta al menos ${String(MINIMO_DE_BORRADORES)} borradores: con menos, la ` +
        'cifra habla de personas concretas y no del colectivo',
    };
  }
  const ofrecidas = conteos.reduce((total, c) => total + c.ofrecidas, 0);
  const aplicadas = conteos.reduce((total, c) => total + c.aplicadas, 0);
  if (ofrecidas === 0) {
    return {
      hayDatos: false,
      borradores: conteos.length,
      porQueNo: 'no se ofreció ninguna sugerencia: no hay nada que aceptar ni que rechazar',
    };
  }
  const tasa = ratio(aplicadas, ofrecidas);
  return {
    hayDatos: true,
    borradores: conteos.length,
    ofrecidas,
    aplicadas,
    tasa,
    enFriccion: cmpFraction(tasa, UMBRAL_DE_FRICCION) >= 0,
  };
}
