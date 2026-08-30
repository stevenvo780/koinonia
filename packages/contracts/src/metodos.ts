/**
 * Los nueve métodos de decisión que el sistema ofrece hoy.
 *
 * Hasta este incremento el contrato HTTP solo conocía los dos primeros (`simple-majority` y
 * `sociocratic-consent`). El motor de `@koinonia/domain` ya implementa las nueve variantes de
 * `DecisionMethod` (`config.ts`), pero la frontera que cruza la red las reducía a dos y
 * `construirMetodo`/`construirQuorum`/`queHaceFaltaParaQuePase` en `services/api/src/http/service.ts`
 * tenían `if` para los dos conocidos y nada para los otros siete. Este fichero es el catálogo que
 * une las tres cosas: lo que la pantalla puede mostrar, lo que el servidor sabe construir y lo que
 * la papeleta admite.
 *
 * ═══ Por qué un único `Record` y no un mapa por método ═══
 *
 * Cada método del dominio define sus propios campos abiertos (`fraction`, `maxRounds`,
 * `scale.grades`…). Definir un esquema Zod por método produce un catálogo con nueve esquemas que
 * cambian de forma, y la pantalla tiene que adivinar cuál cargar por el nombre. Aquí se hace al
 * revés: para CADA método, el contrato expone **qué tipo de papeleta se entrega** y **si admite
 * delegación**, y opcionalmente un esquema para los campos extra. La pantalla pregunta por el
 * método, recibe la forma de la papeleta y la dibuja; cuando hay campos extra, los pide por su
 * nombre y los valida con el esquema que ya viene en la misma entrada del catálogo.
 *
 * El catálogo se lee en un único `GET /metodos`. No es paginado, no es por círculo, no es
 * configurable: la lista es la misma para todo el mundo, y quien abre una votación no la inventa —
 * la elige del catálogo y, si quiere ajustar algún campo, manda la configuración explícita en el
 * `POST /decisiones` con el mismo método.
 *
 * ═══ Forma de la papeleta, en castellano neutro ═══
 *
 * `formasPapeleta` está pensado para que la pantalla arme el formulario de la papeleta. No es
 * nombre del método (eso es `nombre`) ni descripción larga (eso es `descripcion`): es la forma que
 * tiene la papeleta que esta persona va a llenar. «Sí / No», «Puntuar de 0 a 5», «Ordenar de
 * mejor a peor», «Sin objeción / Tengo una reserva / Objeto», «Elegir una mención por opción». La
 * papeleta «un valor por opción» (ranking) se diferencia de «una mención por opción» (mayority
 * judgment) porque para el votante son cosas distintas: la primera es ordenar, la segunda es
 * clasificar con una escala verbal.
 *
 * `delegacionPermitida` repite la regla de GOVERNANCE.md: hay métodos en los que prestar el voto
 * tiene sentido (mayorías con censo alto) y métodos en los que es directamente absurdo (sorteo
 * aleatorio: no se delega sobre una muestra de la que no se sabe ni qué casos son). El catálogo
 * declara la regla; el motor la aplica donde corresponde.
 */

import { z } from 'zod';

/** Las nueve formas de cerrar una votación que el sistema ofrece. */
export const ID_METODOS = [
  'simple-majority',
  'supermajority',
  'unanimity',
  'sociocratic-consent',
  'score',
  'irv',
  'majority-judgment',
  'condorcet-schulze',
  'deliberative-sortition',
  'advice-process',
  'consensus',
] as const;

export type IdMetodo = (typeof ID_METODOS)[number];

/** La forma de la papeleta que se le va a entregar a quien decide. */
export const formaPapeleta = z.enum([
  /** Sí o no, con abstención opcional. Para métodos de umbral binarios. */
  'binaria',
  /** Puntuación numérica por opción (rango 0 a 5). */
  'puntuacion',
  /** Orden de preferencia, de mejor a peor. */
  'ordenamiento',
  /** Una mención verbal por opción, de una escala fijada al abrir. */
  'menciones',
  /** Postura de consentimiento, con reserva u objeción documentada. */
  'consentimiento',
  /** Sin papeleta: el cierre es la muestra sorteada. */
  'sorteo',
  /** Un consejo escrito, con postura. No es un voto: no se cuenta, se lee. */
  'consejo',
  /** De acuerdo, con reservas, me aparto o bloqueo — las cuatro del consenso formal. */
  'consenso',
]);
export type FormaPapeleta = z.infer<typeof formaPapeleta>;

/**
 * La configuración extra de cada método, en su forma **pública** (la que cruza la red).
 *
 * Cada método puede llevar campos opcionales. Cuando el método tiene un campo obligatorio que el
 * motor exige (la fracción de la supermayoría, el plazo del panel sociocrático, la escala de
 * menciones…) y la persona que abre la votación no lo dice, el servidor usa el valor por defecto
 * declarado aquí. Cuando la persona lo dice, ese valor se pasa a `construirMetodo` y se congela en
 * la apertura. Lo que el cliente manda se valida con el mismo esquema que el servidor usa para
 * configurar, así que la única fuente de verdad sobre la forma de la configuración es esta entrada.
 */

// ── Consenso formal ───────────────────────────────────────────────────────────────────────────
const configuracionConsenso = z
  .object({
    /**
     * Qué fracción de quienes se manifiesten puede apartarse sin tumbar el acuerdo. Por defecto 1/4.
     *
     * Un cuarto y no un tercio: pasado ese punto, «acuerdo del grupo» empieza a describir mal lo que
     * pasó. Se puede subir o bajar al abrir, y quien lo haga está diciendo cuánta disidencia
     * silenciosa considera tolerable para ESTE asunto — que es una decisión política, no técnica.
     */
    topeDeApartados: z
      .object({ numerador: z.number().int().min(0), denominador: z.number().int().min(1) })
      .strict()
      .optional(),
  })
  .strict();

// ── Proceso de consejo ────────────────────────────────────────────────────────────────────────
const configuracionConsejo = z
  .object({
    /**
     * Quién decide. Si no se dice, decide quien abre la votación.
     *
     * Se admite nombrar a otra persona porque el caso normal del proceso de consejo es «esto le
     * toca a quien lleva la biblioteca», y quien abre la votación puede ser un tercero que sólo
     * está poniendo el procedimiento en marcha.
     */
    decide: z.string().length(32).optional(),
    /**
     * Cuántos consejos distintos hacen falta. Por defecto 3; el motor no admite menos de 2.
     *
     * Tres y no dos por lo mismo que el motor pide dos: con dos es fácil elegir a quiénes preguntar
     * para que digan lo que uno ya quería oír. No es una garantía —nada acá lo es contra la mala
     * fe— pero encarece la comedia.
     */
    consejosMinimos: z.number().int().min(2).max(50).optional(),
  })
  .strict();

// ── Mayoria simple ────────────────────────────────────────────────────────────────────────────
const configuracionMayoriaSimple = z
  .object({
    /** Qué hacer con las abstenciones al contar el umbral. Por defecto no cuentan. */
    abstenciones: z.enum(['excluir', 'incluir', 'como-no']).optional(),
  })
  .strict();

// ── Supermayoria ──────────────────────────────────────────────────────────────────────────────
const configuracionSupermayoria = z
  .object({
    /**
     * Fracción del denominador que debe apoyar. Por defecto 2/3 (la supermayoría clásica de las
     * reformas estatutarias; GOVERNANCE §4 fila 3).
     */
    fraccion: z
      .object({
        numerador: z.number().int().min(1).max(99),
        denominador: z.number().int().min(1).max(100),
      })
      .strict()
      .optional(),
    /** Estricto (`>`) frente a no estricto (`≥`). Por defecto no estricto. */
    estricto: z.boolean().optional(),
  })
  .strict();

// ── Unanimidad ────────────────────────────────────────────────────────────────────────────────
const configuracionUnanimidad = z
  .object({
    /**
     * Si la abstención rompe la unanimidad. Por defecto la rompe: la regla más fuerte. La
     * desactivar exige una decisión previa del círculo que la autorice (B.4.a); la papeleta deja
     * la advertencia de que cualquier abstención se cuenta como no-unánime.
     */
    abstencionesBloquean: z.boolean().optional(),
  })
  .strict();

// ── Acuerdo interno (sociocrático) ───────────────────────────────────────────────────────────
const configuracionAcuerdoInterno = z
  .object({
    /** Rondas máximas antes de cerrar en no-acuerdo. Por defecto 3 (B.3.c). */
    rondasMaximas: z.number().int().min(1).max(5).optional(),
    /**
     * Fracción del círculo que debe manifestarse. Por defecto 1/2, que es lo que dice GOVERNANCE
     * §4 fila 2 y la regla de compromiso del consentimiento.
     */
    minimoDeParticipacion: z
      .object({
        numerador: z.number().int().min(1).max(99),
        denominador: z.number().int().min(1).max(100),
      })
      .strict()
      .optional(),
    /** Plazo del panel de admisibilidad, en horas. Por defecto 72 (B.3.a). */
    plazoDelPanelHoras: z.number().int().min(1).max(720).optional(),
  })
  .strict();

// ── Puntuación ────────────────────────────────────────────────────────────────────────────────
const configuracionPuntuacion = z
  .object({
    /**
     * Cobertura mínima: cuántas opciones tienen que tener puntuación no nula para que el
     * resultado valga. Por defecto la mitad.
     */
    coberturaMinima: z
      .object({
        numerador: z.number().int().min(1).max(99),
        denominador: z.number().int().min(1).max(100),
      })
      .strict()
      .optional(),
  })
  .strict();

// ── Voto por rondas (IRV) ─────────────────────────────────────────────────────────────────────
const configuracionVotoPorRondas = z
  .object({
    /** Si se admite un ranking parcial (no todas las opciones). Por defecto sí. */
    admiteTruncamiento: z.boolean().optional(),
  })
  .strict();

// ── Valoración por menciones (majority judgment) ─────────────────────────────────────────────
const configuracionMenciones = z
  .object({
    /**
     * Las menciones disponibles, de mejor a peor. Por defecto la escala neutra de cinco grados
     * de Balinski–Laraki. La pantalla la muestra como etiquetas y la papeleta las usa como
     * botones.
     */
    escala: z
      .array(
        z
          .object({
            id: z.string().min(1).max(32),
            etiqueta: z.string().min(1).max(40),
          })
          .strict(),
      )
      .min(3)
      .max(7)
      .optional(),
  })
  .strict();

// ── Comparación por pares (Condorcet–Schulze) ────────────────────────────────────────────────
const configuracionComparacionPares = z
  .object({
    /** Si se admite un ranking parcial. Por defecto sí. */
    admiteTruncamiento: z.boolean().optional(),
  })
  .strict();

// ── Deliberación aleatoria (sortition) ──────────────────────────────────────────────────────
const configuracionSorteo = z
  .object({
    /** Tamaño de la muestra. Por defecto 5 (ADR-0031). */
    tamanoDeMuestra: z.number().int().min(1).max(100).optional(),
  })
  .strict();

/**
 * El esquema discriminado de configuración. La clave de discriminación es `metodo`, igual que en
 * el cuerpo de `abrirDecision`, así que la pantalla puede validar la configuración del método
 * con un solo `parse`.
 */
export const configuracionDeMetodo = z.discriminatedUnion('metodo', [
  // `.strict()`: sin ella, `z.object({...spread})` construye un objeto nuevo en modo «strip» (el
  // default de Zod), que descarta en silencio cualquier campo desconocido en vez de rechazarlo —
  // aunque el esquema del que se copió el `.shape` sí fuera estricto. Comprobado rompiéndolo a
  // propósito (quitando el `.strict()` de esta rama) y viendo caer la prueba correspondiente en
  // `metodos.test.ts` («rechaza campos desconocidos en estricto»); restaurado después.
  z.object({ metodo: z.literal('simple-majority'), ...configuracionMayoriaSimple.shape }).strict(),
  z.object({ metodo: z.literal('supermajority'), ...configuracionSupermayoria.shape }).strict(),
  z.object({ metodo: z.literal('unanimity'), ...configuracionUnanimidad.shape }).strict(),
  z
    .object({ metodo: z.literal('sociocratic-consent'), ...configuracionAcuerdoInterno.shape })
    .strict(),
  z.object({ metodo: z.literal('score'), ...configuracionPuntuacion.shape }).strict(),
  z.object({ metodo: z.literal('irv'), ...configuracionVotoPorRondas.shape }).strict(),
  z.object({ metodo: z.literal('majority-judgment'), ...configuracionMenciones.shape }).strict(),
  z
    .object({ metodo: z.literal('condorcet-schulze'), ...configuracionComparacionPares.shape })
    .strict(),
  z.object({ metodo: z.literal('deliberative-sortition'), ...configuracionSorteo.shape }).strict(),
  z.object({ metodo: z.literal('advice-process'), ...configuracionConsejo.shape }).strict(),
  z.object({ metodo: z.literal('consensus'), ...configuracionConsenso.shape }).strict(),
]);
export type ConfiguracionDeMetodo = z.infer<typeof configuracionDeMetodo>;

/** La forma de la entrada de catálogo. */
export interface MetodoDisponible {
  /** El identificador del motor; es el que se manda en `metodo` al abrir la decisión. */
  readonly id: IdMetodo;
  /** Cómo se nombra en pantalla. Una sola palabra o una frase corta. */
  readonly nombre: string;
  /**
   * Una frase larga explicando, en castellano, qué se decide y con qué regla. Va al pie de la
   * papeleta como descripción. No es jerga: «más síes que noes», no «umbral sobre papeletas
   * emitidas».
   */
  readonly descripcion: string;
  /** La forma de la papeleta que va a llenar quien decide. */
  readonly formasPapeleta: readonly FormaPapeleta[];
  /** Si en este método se puede prestar el voto. */
  readonly delegacionPermitida: boolean;
  /**
   * El esquema Zod de la configuración pública. La pantalla lo usa para validar lo que la
   * persona escribe antes de mandar la apertura. El servidor usa el mismo esquema (más los
   * valores por defecto) para construir la configuración congelada del motor.
   */
  readonly configSchema: z.ZodType;
}

/**
 * El catálogo que consume la pantalla y la ruta `GET /metodos`.
 *
 * El orden es el orden en pantalla. La persona que abre la votación los lee en este orden, de la
 * regla más básica (mayoría simple) a la más costosa de explicar (sorteo deliberativo). No es un
 * orden de preferencia —no hay método «mejor»— sino un orden de comprensión: quien va leyendo
 * entiende cada nuevo a partir del anterior.
 */
export const METODOS_DISPONIBLES: Readonly<Record<IdMetodo, MetodoDisponible>> = {
  'simple-majority': {
    id: 'simple-majority',
    nombre: 'Mayoría simple',
    descripcion:
      'Gana quien tenga más síes que noes. Las abstenciones no cuentan para la mayoría, ' +
      'pero sí para la participación mínima.',
    formasPapeleta: ['binaria'],
    delegacionPermitida: true,
    configSchema: configuracionMayoriaSimple,
  },
  supermajority: {
    id: 'supermajority',
    // «Supermayoría» normaliza a un término prohibido (ADR-0041, GLOSSARY: supermayoria → «mayoría
    // reforzada»); se usa la traducción oficial del glosario, no el tecnicismo.
    nombre: 'Mayoría reforzada',
    descripcion:
      'Hace falta una fracción alta de apoyo (por defecto, dos de cada tres). Se usa para ' +
      'cambiar reglas que comprometen a la comunidad más allá de la mayoría de un día.',
    formasPapeleta: ['binaria'],
    delegacionPermitida: true,
    configSchema: configuracionSupermayoria,
  },
  unanimity: {
    id: 'unanimity',
    nombre: 'Unanimidad',
    descripcion:
      'Se aprueba si nadie muestra objeción. Es la regla más fuerte: cualquier abstención ' +
      'rompe la unanimidad salvo que el círculo diga lo contrario al abrir.',
    formasPapeleta: ['binaria'],
    delegacionPermitida: true,
    configSchema: configuracionUnanimidad,
  },
  'sociocratic-consent': {
    id: 'sociocratic-consent',
    nombre: 'Acuerdo interno',
    descripcion:
      'No hace falta que a todos les guste; hace falta que nadie muestre un daño. Pasa si ' +
      'al cerrar no queda ninguna objeción en pie y se manifestó al menos la mitad del grupo.',
    formasPapeleta: ['consentimiento'],
    delegacionPermitida: false,
    configSchema: configuracionAcuerdoInterno,
  },
  score: {
    id: 'score',
    nombre: 'Puntuación',
    descripcion:
      'Cada persona pone una nota de 0 a 5 a cada opción. Gana la que tenga la mediana ' +
      'más alta. Sirve para elegir entre varias opciones sin obligar a ordenar.',
    formasPapeleta: ['puntuacion'],
    delegacionPermitida: true,
    configSchema: configuracionPuntuacion,
  },
  irv: {
    id: 'irv',
    nombre: 'Voto por rondas',
    descripcion:
      'Cada persona ordena las opciones de la que más le gusta a la que menos. Si nadie ' +
      'tiene mayoría, se elimina la última y se vuelve a contar hasta que alguien llegue.',
    formasPapeleta: ['ordenamiento'],
    delegacionPermitida: true,
    configSchema: configuracionVotoPorRondas,
  },
  'majority-judgment': {
    id: 'majority-judgment',
    nombre: 'Valoración por menciones',
    descripcion:
      'Cada persona valora cada opción con una mención (de «Excelente» a «Rechazar», por ' +
      'defecto). Gana la que tenga la mejor mención mayoritaria, con desempate por ' +
      'eliminación sucesiva.',
    formasPapeleta: ['menciones'],
    delegacionPermitida: true,
    configSchema: configuracionMenciones,
  },
  'condorcet-schulze': {
    id: 'condorcet-schulze',
    nombre: 'Comparación por pares',
    descripcion:
      // No nombra el método de desempate (ADR-0041 prohíbe «Schulze»): se describe lo que hace,
      // no cómo se llama.
      'Cada persona ordena las opciones. Se comparan de a pares y se busca la que le ' +
      'gana a todas las demás en los enfrentamientos; si no existe una así, se repite la ' +
      'comparación entre las que van quedando hasta encontrar la que resiste mejor.',
    formasPapeleta: ['ordenamiento'],
    delegacionPermitida: true,
    configSchema: configuracionComparacionPares,
  },
  'deliberative-sortition': {
    id: 'deliberative-sortition',
    nombre: 'Deliberación aleatoria',
    descripcion:
      'No hay papeleta: se sortea al azar un grupo pequeño del censo, que es el que decide. ' +
      'Sirve cuando el grupo grande no puede deliberar todo y se delega en una muestra.',
    formasPapeleta: ['sorteo'],
    delegacionPermitida: false,
    configSchema: configuracionSorteo,
  },
  'advice-process': {
    id: 'advice-process',
    nombre: 'Proceso de consejo',
    descripcion:
      'No se vota: decide una sola persona, y sólo después de escuchar a otras. Quien decide está ' +
      'obligada a haber recibido consejo de varias personas antes de que su decisión valga, y el ' +
      'consejo NO la ata: puede resolver en contra de todo lo que le dijeron. Sirve para lo que una ' +
      'asamblea no debería votar —qué herramienta usar, cómo redactar un aviso— donde votar ' +
      'convierte una operación en plebiscito y decidir a puerta cerrada la convierte en privilegio.',
    formasPapeleta: ['consejo', 'binaria'],
    delegacionPermitida: false,
    configSchema: configuracionConsejo,
  },
  consensus: {
    id: 'consensus',
    nombre: 'Consenso',
    descripcion:
      'Se aprueba si NADIE bloquea y no se apartó demasiada gente. Tiene una figura que los otros ' +
      'métodos no tienen: apartarse — «no lo apoyo, no lo voy a impedir, y quiero que conste». Sin ' +
      'ella, quien tiene una reserva profunda que no llega a daño tiene que elegir entre fingir ' +
      'acuerdo y bloquear, y las dos son peores que la verdad. Bloquear y apartarse exigen escribir ' +
      'el motivo.',
    formasPapeleta: ['consenso'],
    delegacionPermitida: false,
    configSchema: configuracionConsenso,
  },
};

/** Lista de los nueve métodos en el mismo orden en que se muestran en pantalla. */
export const METODOS_EN_ORDEN: readonly MetodoDisponible[] = ID_METODOS.map(
  (id) => METODOS_DISPONIBLES[id],
);

/**
 * Las cinco formas de papeleta que la pantalla puede tener que dibujar.
 *
 * Por qué no se infiere de `formasPapeleta`: el método puede declarar varias (hoy ninguno, pero
 * la frontera queda abierta). Para la papeleta se toma la primera: es la que se muestra y la que
 * el servidor valida. Es el mismo orden en que la persona va a leer las opciones.
 */
export function formasDePapeleta(id: IdMetodo): readonly FormaPapeleta[] {
  return METODOS_DISPONIBLES[id].formasPapeleta;
}
