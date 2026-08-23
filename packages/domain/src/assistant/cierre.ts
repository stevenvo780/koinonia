/**
 * La frase de cierre y **el modo sin IA**.
 *
 * ═══ La frase es una función, no un dato ═══
 *
 * §3.1 termina el formulario armando la cadena en una sola frase:
 *
 * > «Como **[1]** le pasa a **[2]** porque **[6]**, vamos a **[11]**, con lo que va a quedar
 * > **[16]**, para que **[2]** empiece a **[18]**, y a la larga **[22]**. Esto sólo funciona si
 * > **[8]**. Si vemos **[25]**, lo cambiamos.»
 *
 * Aquí se calcula **cada vez** a partir de las respuestas, y no se guarda en ningún evento. La razón
 * es la única que importa: una frase guardada se desincroniza. Alguien corrige la pregunta 11 tres
 * días después, la frase sigue diciendo lo que decía, y a partir de ahí el sistema tiene dos
 * versiones de lo que la gente acordó hacer —una en las respuestas y otra en la frase— sin que nadie
 * pueda decir cuál manda. Como función pura no hay dos: hay respuestas, y una lectura de ellas.
 *
 * **Errata del documento de origen, resuelta aquí:** §3.1 rotula la frase «(generada, editable)». Las
 * dos cosas juntas no se sostienen. Editable y guardada es exactamente la desincronización de arriba;
 * editable y no guardada no existe. Lo que queda es: la frase se genera, y **editarla es editar las
 * respuestas**, que es donde vive lo que se dijo. La pregunta que la acompaña —«¿Suena bien? ¿Falta
 * algo?»— sigue siendo la invitación a corregir, sólo que corregir lleva al campo correcto en vez de
 * a un texto paralelo.
 *
 * ═══ El modo sin IA no es un modo degradado, es el modo por defecto ═══
 *
 * Un despliegue autoalojado sin ningún proveedor de IA tiene que funcionar entero: las 27 preguntas,
 * los huecos, la frase y el cierre. Sin modelo, el asistente pasa de **generativo** a **estructural**
 * y sigue sirviendo, porque lo que de verdad ayuda a alguien que nunca escribió un plan no es que una
 * máquina se lo redacte: es que le pregunten 27 cosas en orden y le muestren, al final, lo que acaba
 * de decir en una sola frase. Eso es aritmética de texto, no un modelo.
 *
 * Por eso ninguna función de este fichero lanza. **Un error no es una respuesta aceptable**: si al
 * pedir ayuda sin proveedor configurado saltara una excepción, la ausencia de IA sería una avería, y
 * la ausencia de IA es una decisión legítima de quien despliega (principio 10).
 */

import {
  type NumeroPregunta,
  type Pregunta,
  PREGUNTAS,
  TITULO_DE_GRUPO,
  pregunta as preguntaPorNumero,
} from './preguntas.js';
import {
  type AssistantState,
  type DestinoIA,
  type Desajuste,
  type Hueco,
  type Respuesta,
  type VersionDeRespuesta,
  consentimientoCubre,
  desajustes,
  estaRespondida,
  huecos,
  respuestaDe,
  sePuedePedirConsentimiento,
} from './types.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La frase
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Lo que se muestra donde falta una respuesta.
 *
 * Un espacio en blanco y no «(pendiente)» ni «(sin definir)»: la frase con huecos se lee como lo que
 * es, un enunciado a medio llenar, y eso invita a llenarlo. Una etiqueta de estado invita a
 * ignorarlo.
 */
export const HUECO = '______';

/** Lo que se pregunta después de mostrar la frase. Literal de §3.1. */
export const PREGUNTA_DE_CIERRE = '¿Suena bien? ¿Falta algo?';

/**
 * Las preguntas que entran en la frase, **en orden de aparición**. La 2 sale dos veces.
 *
 * Se declara como dato para que la prueba pueda comprobar que la plantilla no cambió: si alguien
 * reordena la frase o mete otra pregunta, esta lista y el texto discrepan y salta.
 */
export const PREGUNTAS_DE_LA_FRASE: readonly NumeroPregunta[] = [1, 2, 6, 11, 16, 2, 18, 22, 8, 25];

export interface FraseDeCierre {
  /** La frase armada. Determinista: las mismas respuestas dan siempre el mismo texto. */
  readonly texto: string;
  /** Las preguntas de la frase que están en blanco, sin repetir y en orden de aparición. */
  readonly huecos: readonly NumeroPregunta[];
  /** Si no queda ningún hueco en la frase. No es lo mismo que poder cerrar el borrador. */
  readonly completa: boolean;
  readonly pregunta: string;
}

/**
 * Une varias líneas en una enumeración castellana: «a, b y c».
 *
 * Sin `Intl` y sin `localeCompare`: es concatenación pura, y el resultado es el mismo en cualquier
 * máquina y con cualquier configuración regional (ADR-0004).
 */
function enumerar(lineas: readonly string[]): string {
  const limpias = lineas.map((l) => l.trim()).filter((l) => l !== '');
  if (limpias.length === 0) return HUECO;
  if (limpias.length === 1) return limpias[0] ?? HUECO;
  const ultima = limpias[limpias.length - 1] ?? HUECO;
  return `${limpias.slice(0, -1).join(', ')} y ${ultima}`;
}

/** Cómo se lee una respuesta dentro de la frase. `todavía no sé` se lee como hueco. */
function comoTexto(respuesta: Respuesta | undefined): string {
  if (respuesta === undefined) return HUECO;
  switch (respuesta.forma) {
    case 'todavia_no_se':
      return HUECO;
    case 'frase': {
      const texto = respuesta.texto.trim();
      return texto === '' ? HUECO : texto;
    }
    case 'lineas':
      return enumerar(respuesta.lineas);
    case 'por_linea':
      return enumerar(respuesta.porLinea);
  }
}

function trozo(estado: AssistantState, numero: NumeroPregunta): string {
  return comoTexto(respuestaDe(estado, numero)?.respuesta);
}

/**
 * La frase armada. Función pura de las respuestas, y de nada más.
 *
 * No lee el reloj, no mira quién es el autor, no depende del orden en que se respondió y no toca el
 * estado. Dos borradores con las mismas respuestas producen exactamente la misma frase, aunque uno
 * las haya escrito al revés y el otro haya cambiado de idea nueve veces.
 */
export function fraseDeCierre(estado: AssistantState): FraseDeCierre {
  const t = (numero: NumeroPregunta): string => trozo(estado, numero);
  const texto =
    `Como ${t(1)} le pasa a ${t(2)} porque ${t(6)}, vamos a ${t(11)}, con lo que va a quedar ` +
    `${t(16)}, para que ${t(2)} empiece a ${t(18)}, y a la larga ${t(22)}. Esto sólo funciona si ` +
    `${t(8)}. Si vemos ${t(25)}, lo cambiamos.`;

  const faltan: NumeroPregunta[] = [];
  for (const numero of PREGUNTAS_DE_LA_FRASE) {
    if (t(numero) === HUECO && !faltan.includes(numero)) faltan.push(numero);
  }

  return {
    texto,
    huecos: faltan,
    completa: faltan.length === 0,
    pregunta: PREGUNTA_DE_CIERRE,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El modo sin IA
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Qué puede hacer hoy el asistente. Se calcula; no se configura. */
export type ModoAsistente = 'generativo' | 'estructural';

/** Por qué no hay sugerencias. Vocabulario cerrado: se le dice a la persona, y sin reproche. */
export type MotivoEstructural =
  'sin_proveedor' | 'sin_consentimiento' | 'consentimiento_negado' | 'borrador_cerrado';

export const MOTIVOS_ESTRUCTURALES: readonly MotivoEstructural[] = [
  'sin_proveedor',
  'sin_consentimiento',
  'consentimiento_negado',
  'borrador_cerrado',
];

/**
 * Lo que se le dice a la persona en cada caso. En castellano llano y sin culpar a nadie (ADR-0041).
 *
 * El de `consentimiento_negado` es el importante: no insinúa que se esté perdiendo algo, porque no se
 * está perdiendo nada que valga la pena presionar. «Sin penalización y sin insistir» también es una
 * regla de redacción.
 */
export const TEXTO_DEL_MOTIVO: Readonly<Record<MotivoEstructural, string>> = {
  sin_proveedor:
    'Acá no hay ningún ayudante automático conectado. Las 27 preguntas y la frase del final ' +
    'funcionan igual.',
  sin_consentimiento:
    'Todavía no nos dijiste si podemos mandar tu texto afuera para pedir ideas. Mientras tanto, ' +
    'seguimos con las preguntas.',
  consentimiento_negado:
    'Dijiste que preferís que tu texto no salga de acá, y así queda. Seguimos con las preguntas.',
  borrador_cerrado: 'Este ya lo cerraste. Si querés cambiar algo, empezá otro.',
};

/** Lo que hay que saber del despliegue para decidir el modo. Entra como dato, como todo aquí. */
export interface DisponibilidadIA {
  /** Si el despliegue tiene un puerto configurado. Sin él, el modo es estructural y punto. */
  readonly hayProveedor: boolean;
  /** A dónde iría el texto. `undefined` cuando no hay proveedor. */
  readonly destino: DestinoIA | undefined;
}

/** El despliegue sin ningún proveedor de IA. Es el valor por defecto, no el caso raro. */
export const SIN_IA: DisponibilidadIA = { hayProveedor: false, destino: undefined };

/**
 * El modo en que está el asistente ahora mismo.
 *
 * Generativo sólo si se cumplen las tres: hay proveedor, hay destino descrito y el consentimiento
 * vigente cubre **ese** destino. Cualquier otra combinación es estructural. No hay bandera que lo
 * fuerce.
 */
export function modoDelAsistente(
  estado: AssistantState,
  disponibilidad: DisponibilidadIA,
): ModoAsistente {
  if (estado.estado !== 'redactando') return 'estructural';
  if (!disponibilidad.hayProveedor) return 'estructural';
  const destino = disponibilidad.destino;
  if (destino === undefined) return 'estructural';
  return consentimientoCubre(estado, destino) ? 'generativo' : 'estructural';
}

/** Por qué el asistente está en modo estructural. Si estuviera en generativo, `undefined`. */
export function motivoEstructural(
  estado: AssistantState,
  disponibilidad: DisponibilidadIA,
): MotivoEstructural | undefined {
  if (modoDelAsistente(estado, disponibilidad) === 'generativo') return undefined;
  if (estado.estado === 'cerrado') return 'borrador_cerrado';
  if (!disponibilidad.hayProveedor || disponibilidad.destino === undefined) return 'sin_proveedor';
  return sePuedePedirConsentimiento(estado) ? 'sin_consentimiento' : 'consentimiento_negado';
}

/**
 * Todo lo que el asistente puede dar sin un modelo detrás.
 *
 * Es deliberadamente **más** de lo que suele dar un asistente generativo: la pregunta con su rótulo,
 * lo que ya está escrito, dónde quedaron los huecos, la frase tal como va, y cuál es la siguiente
 * pregunta. Nada de esto necesita una red.
 */
export interface AyudaEstructural {
  readonly modo: 'estructural';
  readonly pregunta: Pregunta;
  /** El rótulo del tramo: «El problema», «Qué van a hacer»… */
  readonly rotulo: string;
  readonly loQueYaEscribiste: VersionDeRespuesta | undefined;
  /** Si esta pregunta muestra cosas parecidas ya ocurridas. No necesita modelo: es una búsqueda. */
  readonly muestraMemoria: boolean;
  readonly huecos: readonly Hueco[];
  /** Lo que dejó de cuadrar al corregir una lista. Se avisa; no se arregla por cuenta propia. */
  readonly desajustes: readonly Desajuste[];
  readonly frase: FraseDeCierre;
  readonly siguiente: NumeroPregunta | undefined;
  readonly porQueNoHaySugerencias: string;
}

/** La siguiente pregunta sin responder a partir de una dada, o `undefined` si no queda ninguna. */
export function siguientePregunta(
  estado: AssistantState,
  desde: NumeroPregunta,
): NumeroPregunta | undefined {
  for (const p of PREGUNTAS) {
    if (p.numero <= desde) continue;
    const version = respuestaDe(estado, p.numero);
    if (version === undefined || !estaRespondida(version.respuesta)) return p.numero;
  }
  return undefined;
}

/**
 * La ayuda que se entrega cuando no hay modelo. **No lanza nunca.**
 *
 * Vale igual para un borrador recién abierto, para uno a medias, para uno cerrado y para uno que
 * nunca existió: en todos los casos devuelve la pregunta, la frase y los huecos. Esa totalidad es el
 * requisito, no un detalle de implementación.
 */
export function ayudaEstructural(
  estado: AssistantState,
  numero: NumeroPregunta,
  disponibilidad: DisponibilidadIA = SIN_IA,
): AyudaEstructural {
  const p = preguntaPorNumero(numero);
  const motivo = motivoEstructural(estado, disponibilidad) ?? 'sin_proveedor';
  return {
    modo: 'estructural',
    pregunta: p,
    rotulo: TITULO_DE_GRUPO[p.grupo],
    loQueYaEscribiste: respuestaDe(estado, numero),
    muestraMemoria: p.muestraMemoria,
    huecos: huecos(estado),
    desajustes: desajustes(estado),
    frase: fraseDeCierre(estado),
    siguiente: siguientePregunta(estado, numero),
    porQueNoHaySugerencias: TEXTO_DEL_MOTIVO[motivo],
  };
}
