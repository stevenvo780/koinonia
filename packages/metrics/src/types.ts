/**
 * Estructuras de entrada y de salida de las cinco métricas, y la maquinaria que hace **imposible**
 * —no «desaconsejable»— que de este paquete salga una métrica individual.
 *
 * # La prohibición del ADR-0040, en tres capas
 *
 * El ADR-0040 no pide prudencia: prohíbe el artefacto. «No existe endpoint que ordene miembros por
 * cumplimiento». Una regla así no se sostiene con una convención de nombres, porque la convención
 * la rompe el primer `ranking.ts` escrito con prisa un martes. Aquí se sostiene con tres capas
 * independientes, y hay que romper las tres para colar una lista de personas:
 *
 *  1. **El compilador.** `Agregado<T>` vale `never` si `T` contiene —en cualquier profundidad, bajo
 *     cualquier clave, dentro de cualquier arreglo, mapa o conjunto— una `IdentidadMiembro`. Toda
 *     función pública de este paquete declara su retorno como `Agregado<…>`: añadir un campo con
 *     identidades a un tipo de salida convierte su retorno en `never` y el `return` deja de
 *     compilar. `test/adr-0040.test.ts` invoca al compilador de TypeScript para demostrar que esto
 *     es cierto y no una creencia.
 *  2. **El tiempo de ejecución.** `sellar()` recorre la salida entera —claves incluidas, y buscando
 *     también identidades *interpoladas dentro* de una cadena más larga— y lanza
 *     `FugaDeIdentidadError` si encuentra cualquier identificador que venía en la entrada. Las cinco
 *     métricas pasan por él. Una función que devolviera personas ordenadas por actividad
 *     compilaría sólo si además se desactiva la capa 1, y aun así reventaría en la primera llamada.
 *  3. **La entrada.** Donde la métrica no necesita saber quién es quién, la identidad **no está en
 *     el tipo de entrada**: `AcuerdoProyectado` y `EntradaDeliberacion` no tienen ningún campo de
 *     persona. No se puede desglosar por individuo un dato que nunca se recibió.
 *
 * # k-anonimato
 *
 * Con 300 personas, un desglose por estrato puede señalar a alguien por descarte: «de los 4 de
 * décimo semestre nocturno participó 1» identifica a una persona ante cualquiera que conozca a esos
 * cuatro. Se aplica el mismo criterio que el proyecto ya usa en RA-10 del modelo de amenazas:
 * **por debajo de 10 personas no se publica el desglose, y entre 10 y 29 se publica advirtiendo**.
 * No se calla el hecho de callar: `Desglose` distingue «no hay dato» de «hay dato y no se publica».
 *
 * # El tiempo entra como dato
 *
 * No hay un solo `Date.now()` en el paquete (ADR-0004). Toda ventana y todo instante llegan en la
 * entrada, en milisegundos desde la época, y el mismo informe calculado dos veces sobre los mismos
 * datos es el mismo informe.
 */

import type { Fraction } from '@koinonia/domain';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Identidad de miembro: marcada, para que el compilador la vea
// ═══════════════════════════════════════════════════════════════════════════════════════════════

declare const MARCA_MIEMBRO: unique symbol;

/**
 * Identificador de una persona del padrón, **sólo válido en las ENTRADAS**.
 *
 * Es un `string` con una marca fantasma. La marca no cambia nada en tiempo de ejecución y lo cambia
 * todo en tiempo de compilación: permite que `ContieneIdentidad<T>` distinga «una cadena» de «el
 * identificador de una persona», que es justo la distinción que el ADR-0040 necesita y que un
 * `string` desnudo no puede sostener.
 */
export type IdentidadMiembro = string & { readonly [MARCA_MIEMBRO]: 'miembro' };

/** Constructor validador. Toda identidad que entre al paquete pasa por aquí. */
export function identidadMiembro(valor: string): IdentidadMiembro {
  if (valor.length === 0) {
    throw new EntradaInvalidaError('una identidad de miembro no puede ser la cadena vacía');
  }
  return valor as IdentidadMiembro;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Capa 1 — el compilador: `Agregado<T>`
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ¿El tipo `T` puede transportar una identidad de persona, a cualquier profundidad?
 *
 * Recorre arreglos, tuplas, mapas, conjuntos y objetos. Las funciones cuentan como `true` a
 * propósito: una salida que lleva una función es una salida cuyo contenido este análisis no puede
 * acotar, y ante la duda el ADR-0040 se aplica cerrado.
 */
export type ContieneIdentidad<T> = [T] extends [never]
  ? false
  : T extends IdentidadMiembro
    ? true
    : T extends (...args: never[]) => unknown
      ? true
      : T extends ReadonlyMap<infer C, infer V>
        ? ContieneIdentidad<C> | ContieneIdentidad<V>
        : T extends ReadonlySet<infer E>
          ? ContieneIdentidad<E>
          : T extends readonly (infer E)[]
            ? ContieneIdentidad<E>
            : T extends object
              ? { [C in keyof T]-?: ContieneIdentidad<T[C]> }[keyof T]
              : false;

/**
 * `T` si `T` describe al colectivo; `never` si nombra a alguien.
 *
 * El retorno de **toda** función pública de este paquete se declara así. Es la barrera de la que
 * habla la cabecera: no se puede escribir aquí una función que devuelva personas ordenadas por
 * actividad, porque su tipo de retorno sería `never` y el cuerpo no compilaría.
 */
export type Agregado<T> = [ContieneIdentidad<T>] extends [false] ? T : never;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Errores
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Raíz de los rechazos del paquete. Nunca se lanza directamente. */
export class MetricaError extends Error {
  /** Código estable, apto para el registro y para i18n. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MetricaError';
    this.code = code;
  }
}

/**
 * Una salida iba a llevar el identificador de una persona. Es la capa 2 del ADR-0040.
 *
 * **No guarda el identificador encontrado**, sólo la ruta: un error que copia el dato que acaba de
 * impedir que se publique, y lo deja en el registro de errores, no ha impedido nada.
 */
export class FugaDeIdentidadError extends MetricaError {
  /** Ruta dentro de la salida donde apareció la identidad, p. ej. `salida.porEje[2].valor`. */
  readonly ruta: string;

  constructor(ruta: string) {
    super(
      'FUGA_DE_IDENTIDAD',
      `ADR-0040: una métrica intentó devolver el identificador de una persona en «${ruta}». ` +
        `Las cinco métricas de salud describen al colectivo: ninguna puede nombrar, ordenar ni ` +
        `puntuar a nadie. Si hace falta ese dato, no hace falta esta métrica.`,
    );
    this.name = 'FugaDeIdentidadError';
    this.ruta = ruta;
  }
}

/**
 * Se intentó estratificar por un eje que no es de C11.
 *
 * El caso que importa es `genero`: es dato sensible del art. 5 de la Ley 1581 y ligarlo a un
 * identificador estable dentro de un registro publicable expone a sanción de cierre definitivo.
 */
export class EjeProhibidoError extends MetricaError {
  readonly eje: string;

  constructor(eje: string) {
    super(
      'EJE_PROHIBIDO',
      eje === 'genero' || eje === 'género'
        ? `el género no es eje de estratificación (C11): es dato sensible del art. 5 de la Ley ` +
            `1581 y no entra en el desglose. Si la asamblea quiere paridad, se implementa como ` +
            `cuota verificada fuera de estas cuentas.`
        : `«${eje}» no es un eje de estratificación válido; los ejes de C11 son ` +
            `${EJES_ESTRATO.join(', ')}.`,
    );
    this.name = 'EjeProhibidoError';
    this.eje = eje;
  }
}

/** La entrada no está bien formada: ventana invertida, censo negativo, conteo no entero… */
export class EntradaInvalidaError extends MetricaError {
  constructor(razon: string) {
    super('ENTRADA_INVALIDA', `entrada inválida: ${razon}`);
    this.name = 'EntradaInvalidaError';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Capa 2 — el tiempo de ejecución: `sellar()`
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Comprueba que en `salida` no aparece ninguna de las `identidades` que venían en la entrada, y la
 * devuelve tal cual. Si aparece alguna, lanza `FugaDeIdentidadError`.
 *
 * Busca en valores **y en claves de objeto** —un `{ "ana": 12 }` es exactamente el panel de
 * vigilancia que el ADR-0040 prohíbe— y por **subcadena**, para que interpolar el identificador
 * dentro de una frase («la persona ana encabeza…») tampoco pase.
 */
export function sellar<S>(salida: S, identidades: Iterable<string>): S {
  const buscadas: string[] = [];
  for (const identidad of new Set(identidades)) {
    if (identidad.length > 0) buscadas.push(identidad);
  }
  if (buscadas.length > 0) recorrer(salida, buscadas, 'salida', new Set<object>());
  return salida;
}

function comprobarCadena(cadena: string, buscadas: readonly string[], ruta: string): void {
  for (const identidad of buscadas) {
    if (cadena.includes(identidad)) throw new FugaDeIdentidadError(ruta);
  }
}

function recorrer(
  valor: unknown,
  buscadas: readonly string[],
  ruta: string,
  vistos: Set<object>,
): void {
  if (typeof valor === 'string') {
    comprobarCadena(valor, buscadas, ruta);
    return;
  }
  if (valor === null || typeof valor !== 'object') return;
  if (vistos.has(valor)) return;
  vistos.add(valor);

  if (Array.isArray(valor)) {
    const elementos = valor as readonly unknown[];
    for (let i = 0; i < elementos.length; i += 1) {
      recorrer(elementos[i], buscadas, `${ruta}[${i.toString()}]`, vistos);
    }
    return;
  }
  if (valor instanceof Set) {
    let i = 0;
    for (const elemento of valor as ReadonlySet<unknown>) {
      recorrer(elemento, buscadas, `${ruta}{${i.toString()}}`, vistos);
      i += 1;
    }
    return;
  }
  if (valor instanceof Map) {
    for (const [clave, contenido] of valor as ReadonlyMap<unknown, unknown>) {
      recorrer(clave, buscadas, `${ruta}<clave>`, vistos);
      recorrer(contenido, buscadas, `${ruta}<valor>`, vistos);
    }
    return;
  }
  for (const [clave, contenido] of Object.entries(valor as Record<string, unknown>)) {
    comprobarCadena(clave, buscadas, `${ruta}.<clave>`);
    recorrer(contenido, buscadas, `${ruta}.${clave}`, vistos);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Tiempo, ventanas y medidas
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Instante en milisegundos desde la época. Entra como dato: aquí nadie lee el reloj (ADR-0004). */
export type Instante = number;

/** Ventana temporal `[desde, hasta)`: el extremo derecho es abierto, para que no se cuente dos veces. */
export interface Ventana {
  readonly desde: Instante;
  readonly hasta: Instante;
}

/** Los 30 días de `03-deliberativa-sistemas-antipatrones.md` §6, en milisegundos. */
export const VENTANA_DE_30_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

/** ¿`instante` cae dentro de `[ventana.desde, ventana.hasta)`? */
export function dentroDe(ventana: Ventana, instante: Instante): boolean {
  return instante >= ventana.desde && instante < ventana.hasta;
}

export function validarVentana(ventana: Ventana): void {
  if (!Number.isFinite(ventana.desde) || !Number.isFinite(ventana.hasta)) {
    throw new EntradaInvalidaError('los extremos de la ventana deben ser instantes finitos');
  }
  if (ventana.hasta < ventana.desde) {
    throw new EntradaInvalidaError(
      `la ventana termina antes de empezar (desde ${ventana.desde.toString()}, ` +
        `hasta ${ventana.hasta.toString()})`,
    );
  }
}

/**
 * Orden total sobre etiquetas por unidades de código, **sin `localeCompare`** (ADR-0004).
 *
 * Ordena nombres de círculo, de tipo de tarea y de estrato para que dos máquinas con locales
 * distintas produzcan el mismo informe. Nunca ordena personas: para eso no hay función y ese es el
 * punto entero del ADR-0040.
 */
export function compararEtiquetas(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Agrupa por una clave de texto y devuelve los grupos **ordenados por la clave**, no por tamaño.
 *
 * Ordenar por tamaño sería el primer paso hacia un ranking, y aquí ni siquiera para grupos se hace:
 * el orden de presentación no debe insinuar una clasificación que la métrica no afirma.
 */
export function agruparPorEtiqueta<E>(
  elementos: readonly E[],
  clave: (elemento: E) => string,
): readonly (readonly [string, readonly E[]])[] {
  const grupos = new Map<string, E[]>();
  for (const elemento of elementos) {
    const k = clave(elemento);
    const actual = grupos.get(k);
    if (actual === undefined) grupos.set(k, [elemento]);
    else actual.push(elemento);
  }
  return [...grupos.entries()].sort((a, b) => compararEtiquetas(a[0], b[0]));
}

/**
 * Una proporción, o la constancia de que no había con qué calcularla.
 *
 * Cero acuerdos vencidos no es «cumplimiento del 0 %»: es «no hay nada que medir». Confundir las
 * dos cosas es cómo un panel acaba mostrando una alarma roja el primer día de vida del sistema.
 *
 * # Por qué la fracción NO viene reducida
 *
 * Se sigue la regla que `packages/domain/src/fraction.ts` ya fija y que aquí encaja igual: los
 * **índices de concentración** se reducen —dos repartos con el mismo valor deben tener la misma
 * estructura— y las **proporciones de participación** no, porque el par dice más que el cociente.
 * «12 de 40» y «120 de 400» son la misma proporción y no son la misma noticia, y una comunidad que
 * lee su serie histórica necesita distinguirlas. La comparación con un umbral se hace con
 * `cmpFraction`, a la que la reducción le da exactamente igual.
 */
export type Medida =
  | { readonly hay: true; readonly valor: Fraction }
  | { readonly hay: false; readonly motivo: 'sin-datos' };

export const SIN_DATOS: Medida = { hay: false, motivo: 'sin-datos' };

export function medida(valor: Fraction): Medida {
  return { hay: true, valor };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// k-anonimato
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Por debajo de 10 personas **no se publica** el desglose de un grupo.
 *
 * Es el mismo número que RA-10 del modelo de amenazas fija para el escrutinio detallado, y se
 * reutiliza a propósito: dos umbrales distintos para el mismo riesgo son dos umbrales que alguien
 * tendrá que explicar, y el segundo siempre acaba siendo el laxo.
 */
export const K_NO_SE_PUBLICA = 10;

/** Entre 10 y 29 personas se publica **con advertencia** (RA-10: «con participación <30 se advierte»). */
export const K_SE_ADVIERTE = 30;

/**
 * Umbral propio y más estricto para las medidas que son un **máximo individual** en vez de una
 * propiedad de toda la distribución.
 *
 * «Cuánto puso la persona que más habló» no nombra a nadie, pero es el dato de una sola persona:
 * en un grupo pequeño, donde todos saben quién habla más, publicarlo equivale a publicar su
 * conteo. Las medidas de ese tipo exigen 30 personas, no 10.
 */
export const K_MAXIMO_INDIVIDUAL = K_SE_ADVIERTE;

export type MotivoNoPublicado = 'grupo-demasiado-pequeno';

/**
 * El resultado de un grupo: publicado (con aviso si el grupo es pequeño) o retenido.
 *
 * Cuando se retiene **no se dice cuánta gente hay**: en un desglose cruzado, «este grupo tiene 3
 * personas» ya es información sobre esas tres. Se dice que no se publica y por qué, que es lo que
 * pide el encargo y lo que una persona necesita para no sospechar que le esconden un número malo.
 */
export type Desglose<T> =
  | {
      readonly publicado: true;
      readonly personas: number;
      /** El grupo tiene menos de `K_SE_ADVIERTE`: el dato vale, pero se mueve mucho con muy poco. */
      readonly grupoPequeno: boolean;
      readonly valor: T;
    }
  | { readonly publicado: false; readonly motivo: MotivoNoPublicado };

export const NO_SE_PUBLICA: Desglose<never> = {
  publicado: false,
  motivo: 'grupo-demasiado-pequeno',
};

/**
 * Publica el valor sólo si el grupo llega a `K_NO_SE_PUBLICA`. `calcular` es perezosa: si el grupo
 * es demasiado pequeño, el valor **no se calcula**, y así no puede acabar en un registro por
 * descuido.
 */
export function publicarSiHayGente<T>(personas: number, calcular: () => T): Desglose<T> {
  if (personas < K_NO_SE_PUBLICA) return NO_SE_PUBLICA;
  return {
    publicado: true,
    personas,
    grupoPequeno: personas < K_SE_ADVIERTE,
    valor: calcular(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1 — Acuerdos: cumplimiento y deuda
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Un acuerdo, ya proyectado. **No lleva persona, y no es un olvido.**
 *
 * El ADR-0040 dice que las métricas de cumplimiento son «del círculo y del tipo de tarea». Aquí eso
 * no es una recomendación de uso: es el tipo. Nadie puede pedirle a este paquete el cumplimiento
 * por persona, porque la persona nunca entró.
 */
export interface AcuerdoProyectado {
  /** Círculo responsable. Es un nombre de grupo, no de persona. */
  readonly circulo: string;
  /** Tipo de tarea (redacción, convocatoria, gestión…). */
  readonly tipo: string;
  /** Instante en que se acordó. */
  readonly acordadoEn: Instante;
  /** Fecha comprometida. */
  readonly vencimiento: Instante;
  /** Instante de cierre, o `null` si sigue abierto. */
  readonly cerradoEn: Instante | null;
  /**
   * Alguien declaró bloqueo o pidió ayuda: **el reloj está detenido** (ADR-0040). No cuenta como
   * incumplido ni entra en la deuda. Si avisar castigara, nadie avisaría.
   */
  readonly relojDetenido: boolean;
}

/** Cuánta gente hay en un círculo. Necesario para el k-anonimato del desglose por círculo. */
export interface TamanoDeCirculo {
  readonly circulo: string;
  readonly personas: number;
}

export interface EntradaAcuerdos {
  readonly ventana: Ventana;
  /** «Ahora», como dato. Un acuerdo está vencido si su fecha ya pasó respecto a este instante. */
  readonly instante: Instante;
  readonly acuerdos: readonly AcuerdoProyectado[];
  readonly circulos: readonly TamanoDeCirculo[];
  /**
   * Prescripción del ADR-0040: «los atrasos caducan a los dos semestres». En milisegundos, como
   * dato. Un vencimiento anterior a `instante − prescripcionMs` sale de la deuda.
   */
  readonly prescripcionMs: number;
}

export interface CuentaDeAcuerdos {
  /** Acuerdos cuya fecha vencía dentro de la ventana. Es la base de todo lo demás. */
  readonly vencianEnLaVentana: number;
  /** Cerrados, a tiempo o tarde. */
  readonly cumplidos: number;
  /** Cerrados después de su fecha. Se cuentan como cumplidos, y además aparte. */
  readonly cumplidosTarde: number;
  /** **La deuda**: vencidos, sin cerrar, sin reloj detenido y sin prescribir. */
  readonly deuda: number;
  /** Con bloqueo declarado o petición de ayuda: fuera del cociente, por decisión del ADR-0040. */
  readonly conRelojDetenido: number;
  /** Vencidos hace más de la prescripción: salen de la deuda. */
  readonly prescritos: number;
  /** Todavía no vencían al instante del informe. */
  readonly enCurso: number;
  /** `cumplidos / (cumplidos + deuda)`. Exacta: alimenta la alarma del 0,5. */
  readonly cumplimiento: Medida;
}

export interface CumplimientoDeCirculo {
  readonly circulo: string;
  readonly desglose: Desglose<CuentaDeAcuerdos>;
}

export interface CumplimientoDeTipo {
  readonly tipo: string;
  readonly cuenta: CuentaDeAcuerdos;
}

export interface InformeAcuerdos {
  readonly ventana: Ventana;
  readonly total: CuentaDeAcuerdos;
  /**
   * El cumplimiento global está por debajo de la mitad. §6: «bajo 0.5 sostenido, la plataforma es
   * teatro». Comparación con fracción exacta, nunca con `0.5` en coma flotante.
   */
  readonly bajoLaMitad: boolean;
  readonly porCirculo: readonly CumplimientoDeCirculo[];
  readonly porTipo: readonly CumplimientoDeTipo[];
  readonly circulosNoPublicados: number;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2 — Concentración de voz
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Un acto de habla ya proyectado: quién y cuándo. **Nunca qué**: este paquete no ve texto.
 *
 * La identidad hace falta para agrupar por autoría, y sale del cálculo convertida en un conteo sin
 * nombre. `sellar()` comprueba en cada llamada que efectivamente no sobrevivió a la salida.
 */
export interface Aporte {
  readonly autor: IdentidadMiembro;
  readonly instante: Instante;
}

export interface EntradaVoz {
  readonly ventana: Ventana;
  readonly aportes: readonly Aporte[];
  /** Tamaño del padrón. El denominador de «cuánto puso quien más habló» es el censo, no quien habló. */
  readonly censo: number;
}

export interface RepartoDeVoz {
  /** Cuántas personas distintas hablaron en la ventana. */
  readonly personasQueHablaron: number;
  /**
   * Qué tan repartida está la voz, de 0 (todos por igual) a 1 (una sola persona).
   *
   * Es el índice normalizado de `@koinonia/domain`, exacto en fracciones. Alimenta la alarma, así
   * que no puede ser coma flotante.
   */
  readonly reparto: Fraction;
  /** El mismo índice sin normalizar. Se publica para que la cifra sea recomputable. */
  readonly repartoBruto: Fraction;
  /**
   * Cuánto del total puso la persona que más habló, sobre el censo.
   *
   * Es la única medida del paquete que describe a **una** persona, aunque no la nombre. Por eso
   * exige `K_MAXIMO_INDIVIDUAL` personas hablando, y no las 10 del resto.
   */
  readonly mayorParticipacion: Desglose<Fraction>;
  /** Umbral superado (§6: alarma en 0,15). No invalida nada: marca. */
  readonly alarma: boolean;
}

export interface InformeVoz {
  readonly ventana: Ventana;
  readonly censo: number;
  readonly aportesContados: number;
  readonly reparto: Desglose<RepartoDeVoz>;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3 — Cobertura del padrón por estrato
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Los cuatro ejes de C11. **El género no está, y no se puede añadir**: `validarEstratos()` rechaza
 * cualquier clave fuera de esta lista, porque las proyecciones se construyen en tiempo de ejecución
 * y un tipo no detiene un objeto que llega con una clave de más.
 */
export const EJES_ESTRATO = ['semestre', 'jornada', 'nivel', 'participacionPrevia'] as const;

export type EjeEstrato = (typeof EJES_ESTRATO)[number];

/** El estrato de una persona: exactamente los cuatro ejes de C11, cada uno como etiqueta. */
export type Estratos = { readonly [E in EjeEstrato]: string };

export interface MiembroDelPadron {
  readonly miembro: IdentidadMiembro;
  readonly estratos: Estratos;
}

/**
 * Un acto significativo: participar de verdad en algo, no abrir la aplicación.
 *
 * Qué cuenta como significativo lo decide la proyección, no este paquete. Lo que este paquete
 * garantiza es que **no** mide sesiones ni tiempo en línea, porque no los recibe.
 */
export interface ActoSignificativo {
  readonly miembro: IdentidadMiembro;
  readonly instante: Instante;
}

export interface EntradaCobertura {
  readonly ventana: Ventana;
  readonly padron: readonly MiembroDelPadron[];
  readonly actos: readonly ActoSignificativo[];
}

export interface CoberturaDeGrupo {
  readonly conAlMenosUnActo: number;
  readonly cobertura: Fraction;
}

export interface CeldaDeEje {
  readonly eje: EjeEstrato;
  readonly valor: string;
  readonly desglose: Desglose<CoberturaDeGrupo>;
}

/** El cruce `semestre × jornada` de §6. Dos ejes, que es el máximo que C11 admite cruzar. */
export interface CeldaDeCruce {
  readonly semestre: string;
  readonly jornada: string;
  readonly desglose: Desglose<CoberturaDeGrupo>;
}

export interface InformeCobertura {
  readonly ventana: Ventana;
  readonly padron: number;
  readonly global: Desglose<CoberturaDeGrupo>;
  readonly porEje: readonly CeldaDeEje[];
  readonly cruceSemestreJornada: readonly CeldaDeCruce[];
  /**
   * Distancia entre el grupo al que más llega y el grupo al que menos, sobre las celdas
   * publicadas. Es la cifra que delata al «40 % global con la nocturna en el 8 %».
   */
  readonly brecha: Medida;
  readonly celdasNoPublicadas: number;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 4 — Rotación del núcleo activo
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export interface EntradaRotacion {
  readonly periodoAnterior: Ventana;
  readonly periodoActual: Ventana;
  readonly aportesAnteriores: readonly Aporte[];
  readonly aportesActuales: readonly Aporte[];
}

export interface CambioDelNucleo {
  readonly nucleoAnterior: number;
  readonly nucleoActual: number;
  /** Personas del núcleo anterior que ya no están en el actual. */
  readonly salieron: number;
  /** `salieron / nucleoAnterior`. Cero significa que el núcleo no se movió nada. */
  readonly rotacion: Fraction;
  /** Personas que participan ahora y no participaban antes. */
  readonly personasNuevas: number;
  readonly proporcionDePersonasNuevas: Fraction;
  /**
   * Número de aportes a partir del cual se pertenece al núcleo, en cada período.
   *
   * Se publica para que la cifra sea recomputable **y** porque explica los empates: el núcleo se
   * define por un corte sobre la distribución de aportes, no ordenando personas, así que quien
   * empata con el corte entra. Un núcleo puede por eso ser mayor que la décima parte exacta.
   */
  readonly corteAnterior: number;
  readonly corteActual: number;
}

export interface InformeRotacion {
  readonly periodoAnterior: Ventana;
  readonly periodoActual: Ventana;
  readonly participantesAnteriores: number;
  readonly participantesActuales: number;
  readonly cambio: Desglose<CambioDelNucleo>;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 5 — Razón deliberación/votación
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Una deliberación cerrada. Sin autoría: aquí no hace falta y por tanto no está. */
export interface DeliberacionProyectada {
  readonly instante: Instante;
  /** Cuántas intervenciones hubo. Un número, no una lista de personas. */
  readonly intervenciones: number;
}

export interface VotacionProyectada {
  readonly instante: Instante;
  /** Salió sin un solo voto en contra. */
  readonly unanime: boolean;
  /** La votación estuvo precedida de deliberación registrada. */
  readonly conDeliberacionPrevia: boolean;
}

export interface EntradaDeliberacion {
  readonly ventana: Ventana;
  readonly deliberaciones: readonly DeliberacionProyectada[];
  readonly votaciones: readonly VotacionProyectada[];
}

export interface InformeDeliberacion {
  readonly ventana: Ventana;
  readonly deliberaciones: number;
  readonly intervenciones: number;
  readonly votaciones: number;
  readonly votacionesUnanimes: number;
  readonly votacionesSinDeliberacionPrevia: number;
  /** `deliberaciones / votaciones`. Puede pasar de 1: no es una proporción, es una razón. */
  readonly razon: Medida;
  readonly intervencionesPorVotacion: Medida;
  /** `unánimes / votaciones`. Alta no es buena noticia: puede ser que el disenso se haya ido. */
  readonly unanimidad: Medida;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// El panel completo
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export interface EntradaSalud {
  readonly acuerdos: EntradaAcuerdos;
  readonly voz: EntradaVoz;
  readonly cobertura: EntradaCobertura;
  readonly rotacion: EntradaRotacion;
  readonly deliberacion: EntradaDeliberacion;
}

export interface InformeSalud {
  readonly acuerdos: InformeAcuerdos;
  readonly voz: InformeVoz;
  readonly cobertura: InformeCobertura;
  readonly rotacion: InformeRotacion;
  readonly deliberacion: InformeDeliberacion;
}
