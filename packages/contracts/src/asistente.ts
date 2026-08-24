/**
 * Contrato HTTP del **asistente de acción sistémica** (ADR-0052).
 *
 * Expone las 27 preguntas de teoría del cambio de `docs/research/03-deliberativa-sistemas-
 * antipatrones.md` §3.1 y el ciclo del borrador: empezar, contestar una pregunta, retomar donde se
 * dejó, cerrar. Ningún esquema de aquí inventa forma: cada uno copia un tipo o una constante de
 * `packages/domain/src/assistant/` para que las dos capas —la que valida al entrar y la que aplica
 * las reglas de verdad— no puedan divergir en silencio.
 *
 * ═══ La regla que gobierna todo este fichero, otra vez ═══
 *
 * Principio 6: **la IA asesora, nunca gobierna ni vota.** En este contrato eso se ve en tres sitios
 * concretos:
 *
 *  1. `pedirSugerencia` no lleva ningún campo que la máquina pueda usar para decidir por alguien: ni
 *     un peso, ni un identificador de destino inventado por el cliente —el destino que se muestra al
 *     pedir consentimiento lo fija el despliegue, nunca el formulario—.
 *  2. `sugerenciaRecibida` —lo que vuelve tras pedir ayuda— es texto y nada más: ninguna de las
 *     siete formas (`estructuraSugerida`, `resumenSugerido`…) tiene un campo numérico salvo el
 *     número de la pregunta a la que apunta un tramo, que es una etiqueta de formulario, no un peso.
 *  3. `decidirConsentimiento` sólo lleva `concedido`: el `destino` que se registra es el que el
 *     servidor ya conoce (`DisponibilidadIA` del despliegue), nunca uno que el cliente proponga. Si
 *     el cliente pudiera mandar su propio destino, cualquiera podría hacerle creer al historial que
 *     alguien consintió a mandar su texto a un sitio que nunca se le mostró.
 *
 * ═══ Por qué tantos esquemas están duplicados en vez de importados de `assistant/index.ts` ═══
 *
 * Podrían derivarse con `z.custom<T>()`, pero eso cambia «el contrato lo define Zod» por «el
 * contrato lo define TypeScript y Zod sólo lo repite de memoria», que es exactamente el problema que
 * este paquete existe para evitar en la frontera HTTP (ver la cabecera de `http.ts`). Donde el
 * dominio expone una **lista cerrada** como dato —`OPERACIONES`, `FORMAS`, `GRUPOS`, `ORIGENES`,
 * `ESTADOS_BORRADOR`, `MOTIVOS_ESTRUCTURALES`— este fichero construye el enumerado de Zod a partir de
 * esa lista, así que si el dominio añade una octava operación el enumerado la admite solo. Donde el
 * dominio expone la forma como un **tipo cerrado** (`Respuesta`, con cuatro variantes) no hay lista
 * que leer en tiempo de ejecución, así que las cuatro se escriben aquí a mano; un quinto miembro no
 * puede colarse sin que alguien también reescriba el `switch` exhaustivo de `cierre.ts`, que revienta
 * en compilación antes de llegar aquí.
 */

import { z } from 'zod';
import {
  CUANTAS_PREGUNTAS,
  ESTADOS_BORRADOR,
  FORMAS,
  GRUPOS,
  MAX_LINEAS,
  MAX_TEXTO_SUGERIDO,
  MOTIVOS_ESTRUCTURALES,
  OPERACIONES,
  ORIGENES,
  TITULO_DE_GRUPO,
  TITULO_DE_OPERACION,
} from '@koinonia/domain';

import { instantMs, opaqueId } from './ids.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Vocabulario de pantalla que copia el del dominio, para que la interfaz no reescriba lo ya escrito
// ═════════════════════════════════════════════════════════════════════════════════════════════

export { TITULO_DE_GRUPO, TITULO_DE_OPERACION };

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Números y enumerados cerrados
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** El número de una de las 27 preguntas. Un entero de 1 a `CUANTAS_PREGUNTAS`, no un texto libre. */
export const numeroPregunta = z.number().int().min(1).max(CUANTAS_PREGUNTAS);
export type NumeroPreguntaDto = z.infer<typeof numeroPregunta>;

export const grupoPregunta = z.enum(GRUPOS);
export type GrupoPreguntaDto = z.infer<typeof grupoPregunta>;

export const formaDeRespuesta = z.enum(FORMAS);
export type FormaDeRespuestaDto = z.infer<typeof formaDeRespuesta>;

export const origenDeRespuesta = z.enum(ORIGENES);
export type OrigenDeRespuestaDto = z.infer<typeof origenDeRespuesta>;

export const estadoBorrador = z.enum(ESTADOS_BORRADOR);
export type EstadoBorradorDto = z.infer<typeof estadoBorrador>;

export const operacionIA = z.enum(OPERACIONES);
export type OperacionIADto = z.infer<typeof operacionIA>;

export const modoAsistente = z.enum(['generativo', 'estructural']);
export type ModoAsistenteDto = z.infer<typeof modoAsistente>;

export const motivoEstructural = z.enum(MOTIVOS_ESTRUCTURALES);
export type MotivoEstructuralDto = z.infer<typeof motivoEstructural>;

/**
 * Por qué falta una respuesta. `MotivoDeHueco` del dominio no se expone como lista —son sólo dos y
 * el propio tipo lo dice todo—, así que se escribe aquí a mano; un tercer motivo no puede colarse sin
 * tocar antes `huecos()` en `packages/domain/src/assistant/types.ts`.
 */
export const motivoDeHueco = z.enum(['sin_responder', 'todavia_no_se']);
export type MotivoDeHuecoDto = z.infer<typeof motivoDeHueco>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Texto
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Un renglón de texto de una respuesta. El servidor todavía normaliza (NFC, sin retorno de carro)
 * antes de que esto llegue al dominio; aquí sólo se acota el largo, para que el campo diga en la
 * propia pantalla cuánto sobra en vez de que lo diga un rechazo genérico del servidor.
 */
const lineaDeTexto = z.string().min(1).max(MAX_TEXTO_SUGERIDO);

/**
 * Lo que alguien contesta a una pregunta. Las cuatro formas de `Respuesta` en
 * `packages/domain/src/assistant/types.ts`, literales.
 *
 * `todavia_no_se` vale en las 27 preguntas —§3.1— y es la única forma que nunca desencaja con la que
 * pide la pregunta (`formaEncaja`); las otras tres tienen que coincidir con la `forma` de la
 * pregunta que responden, y eso lo comprueba el pliegue, no este esquema.
 */
export const respuestaPregunta = z.discriminatedUnion('forma', [
  z.object({ forma: z.literal('frase'), texto: lineaDeTexto }).strict(),
  z
    .object({ forma: z.literal('lineas'), lineas: z.array(lineaDeTexto).min(1).max(MAX_LINEAS) })
    .strict(),
  z
    .object({
      forma: z.literal('por_linea'),
      porLinea: z.array(lineaDeTexto).min(1).max(MAX_LINEAS),
    })
    .strict(),
  z.object({ forma: z.literal('todavia_no_se') }).strict(),
]);
export type RespuestaPreguntaDto = z.infer<typeof respuestaPregunta>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Preguntas, huecos y desajustes
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Una de las 27 preguntas, tal como la sirve `GET /asistente/preguntas`. */
export const preguntaAsistente = z
  .object({
    numero: numeroPregunta,
    grupo: grupoPregunta,
    rotuloGrupo: z.string(),
    /** El texto literal de §3.1. Sin jerga: es la primera línea que comprueba ADR-0041. */
    texto: z.string(),
    forma: formaDeRespuesta,
    /** Sólo la 1 y la 11. */
    obligatoria: z.boolean(),
    /** Presente sólo en la 7: de qué pregunta enumera las líneas. */
    porCadaLineaDe: numeroPregunta.optional(),
    muestraMemoria: z.boolean(),
  })
  .strict();
export type PreguntaAsistenteDto = z.infer<typeof preguntaAsistente>;

export const huecoPregunta = z
  .object({ pregunta: numeroPregunta, motivo: motivoDeHueco, bloquea: z.boolean() })
  .strict();
export type HuecoPreguntaDto = z.infer<typeof huecoPregunta>;

/** Una respuesta «por cada línea» que dejó de cuadrar con la lista que enumeraba. Se avisa, no se corrige sola. */
export const desajustePregunta = z
  .object({
    pregunta: numeroPregunta,
    deLaPregunta: numeroPregunta,
    tiene: z.number().int().nonnegative(),
    deberiaTener: z.number().int().nonnegative(),
  })
  .strict();
export type DesajustePreguntaDto = z.infer<typeof desajustePregunta>;

export const fraseDeCierre = z
  .object({
    texto: z.string(),
    /** Las preguntas de la frase que están en blanco, sin repetir, en orden de aparición. */
    huecos: z.array(numeroPregunta),
    completa: z.boolean(),
    /** «¿Suena bien? ¿Falta algo?», literal de §3.1. */
    pregunta: z.string(),
  })
  .strict();
export type FraseDeCierreDto = z.infer<typeof fraseDeCierre>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El destino de la IA y el consentimiento
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A dónde va el texto y qué se manda, en las palabras con que se le dice a la persona.
 *
 * **Sólo el servidor lo produce.** El cliente nunca lo escribe: si pudiera, cualquiera podría
 * fabricar un consentimiento para un destino que nunca se le mostró a nadie. Por eso no aparece
 * dentro de `decidirConsentimiento`.
 */
export const destinoIA = z
  .object({
    aDondeVa: z.string().min(1).max(200),
    queSeManda: z.string().min(1).max(400),
    queNoSeManda: z.string().min(1).max(400),
    enLaMismaMaquina: z.boolean(),
  })
  .strict();
export type DestinoIADto = z.infer<typeof destinoIA>;

export const consentimientoVigente = z
  .object({ concedido: z.boolean(), destino: destinoIA, decididoEn: instantMs })
  .strict();
export type ConsentimientoVigenteDto = z.infer<typeof consentimientoVigente>;

/** `POST /asistente/borradores/:id/consentimiento`. Sólo el sí o el no; el destino lo pone el servidor. */
export const decidirConsentimiento = z.object({ concedido: z.boolean() }).strict();
export type DecidirConsentimientoDto = z.infer<typeof decidirConsentimiento>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Procedencia: qué escribió una persona y qué le propuso una máquina
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const versionRespuesta = z
  .object({
    pregunta: numeroPregunta,
    respuesta: respuestaPregunta,
    origen: origenDeRespuesta,
    /**
     * `true` ⟺ `origen === 'sugerencia'` (T-25, `docs/THREAT_MODEL.md`): la marca visible de que
     * este texto no lo escribió la persona a mano, sino que lo tomó de una sugerencia del
     * ayudante. Es redundante con `origen` a propósito — no es un segundo dato, es el mismo dato
     * dicho en la forma que promete el modelo de amenaza, para que ninguna pantalla ni ningún
     * cliente tenga que conocer la regla `origen === 'sugerencia'` para mostrar la bandera.
     */
    assisted: z.boolean(),
    /** Presente sólo si `origen` es `'sugerencia'`. */
    sugerenciaId: opaqueId.optional(),
    escritaEn: instantMs,
    seq: z.number().int().positive(),
  })
  .strict();
export type VersionRespuestaDto = z.infer<typeof versionRespuesta>;

export const procedenciaDeRespuesta = z
  .object({
    pregunta: numeroPregunta,
    origen: origenDeRespuesta,
    /** Ver la nota de `assisted` en `versionRespuesta`: la misma marca, la misma regla. */
    assisted: z.boolean(),
    sugerenciaId: opaqueId.optional(),
    escritaEn: instantMs,
    seq: z.number().int().positive(),
    /** Cuántas veces se reescribió antes de quedar así. */
    versiones: z.number().int().positive(),
  })
  .strict();
export type ProcedenciaDeRespuestaDto = z.infer<typeof procedenciaDeRespuesta>;

export const sugerenciaRegistrada = z
  .object({
    sugerenciaId: opaqueId,
    operacion: operacionIA,
    /** `undefined` cuando la sugerencia miraba el borrador entero (p. ej. `estructurar`). */
    pregunta: numeroPregunta.optional(),
    /** El aplanado de lo que propuso la máquina. Es contra esto que se coteja `aplicarSugerencia`. */
    textos: z.array(z.string()),
    destino: destinoIA,
  })
  .strict();
export type SugerenciaRegistradaDto = z.infer<typeof sugerenciaRegistrada>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lo que devuelve pedir ayuda a la IA — siete formas, todas texto
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const tramoSugerido = z.object({ pregunta: numeroPregunta, texto: z.string() }).strict();
export const estructuraSugerida = z.object({ tramos: z.array(tramoSugerido) }).strict();

export const resumenSugerido = z.object({ resumen: z.string() }).strict();

export const parecidoSugerido = z.object({ texto: z.string(), porQue: z.string() }).strict();
export const parecidosSugeridos = z.object({ parecidos: z.array(parecidoSugerido) }).strict();

export const tensionSugerida = z
  .object({ unaParte: z.string(), otraParte: z.string(), porQue: z.string() })
  .strict();
export const contradiccionesSugeridas = z.object({ tensiones: z.array(tensionSugerida) }).strict();

export const alternativasSugeridas = z.object({ alternativas: z.array(z.string()) }).strict();

export const tareasSugeridas = z.object({ tareas: z.array(z.string()) }).strict();

export const explicacionSugerida = z.object({ explicacion: z.string() }).strict();

/**
 * Lo que vuelve de `POST /asistente/borradores/:id/sugerencias`.
 *
 * Discriminada por `operacion`, para que el cliente sepa sin adivinar qué forma trae `contenido` —
 * la misma unión que `AIAssistantPort` en el dominio, con `sugerenciaId` y `destino` puestos por el
 * servidor al registrarla.
 */
export const sugerenciaRecibida = z.discriminatedUnion('operacion', [
  z
    .object({
      operacion: z.literal('estructurar'),
      sugerenciaId: opaqueId,
      pregunta: numeroPregunta.optional(),
      destino: destinoIA,
      contenido: estructuraSugerida,
    })
    .strict(),
  z
    .object({
      operacion: z.literal('resumir'),
      sugerenciaId: opaqueId,
      pregunta: numeroPregunta.optional(),
      destino: destinoIA,
      contenido: resumenSugerido,
    })
    .strict(),
  z
    .object({
      operacion: z.literal('buscar_parecidos'),
      sugerenciaId: opaqueId,
      pregunta: numeroPregunta.optional(),
      destino: destinoIA,
      contenido: parecidosSugeridos,
    })
    .strict(),
  z
    .object({
      operacion: z.literal('senalar_contradicciones'),
      sugerenciaId: opaqueId,
      pregunta: numeroPregunta.optional(),
      destino: destinoIA,
      contenido: contradiccionesSugeridas,
    })
    .strict(),
  z
    .object({
      operacion: z.literal('proponer_alternativas'),
      sugerenciaId: opaqueId,
      pregunta: numeroPregunta.optional(),
      destino: destinoIA,
      contenido: alternativasSugeridas,
    })
    .strict(),
  z
    .object({
      operacion: z.literal('partir_en_tareas'),
      sugerenciaId: opaqueId,
      pregunta: numeroPregunta.optional(),
      destino: destinoIA,
      contenido: tareasSugeridas,
    })
    .strict(),
  z
    .object({
      operacion: z.literal('explicar_una_regla'),
      sugerenciaId: opaqueId,
      pregunta: numeroPregunta.optional(),
      destino: destinoIA,
      contenido: explicacionSugerida,
    })
    .strict(),
]);
export type SugerenciaRecibidaDto = z.infer<typeof sugerenciaRecibida>;

/** `POST /asistente/borradores/:id/sugerencias`. Pedir ayuda a la IA sobre un fragmento propio. */
export const pedirSugerencia = z
  .object({
    operacion: operacionIA,
    /** A qué pregunta apunta; ausente cuando se le pide que mire el borrador entero. */
    pregunta: numeroPregunta.optional(),
    fragmento: z.string().min(1).max(MAX_TEXTO_SUGERIDO),
    /** Sólo para `buscar_parecidos`: material ya público con qué comparar. Ver ADR-0052 (E84). */
    conQueComparar: z.array(z.string().min(1).max(MAX_TEXTO_SUGERIDO)).max(20).optional(),
  })
  .strict();
export type PedirSugerenciaDto = z.infer<typeof pedirSugerencia>;

/** `POST /asistente/borradores/:id/sugerencias/:sugerenciaId/aplicar`. */
export const aplicarSugerencia = z
  .object({ pregunta: numeroPregunta, respuesta: respuestaPregunta })
  .strict();
export type AplicarSugerenciaDto = z.infer<typeof aplicarSugerencia>;

/** `POST /asistente/borradores/:id/respuestas`. Escribir o reescribir una respuesta a mano. */
export const escribirRespuesta = z
  .object({ pregunta: numeroPregunta, respuesta: respuestaPregunta })
  .strict();
export type EscribirRespuestaDto = z.infer<typeof escribirRespuesta>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El borrador: resumen, detalle y la ayuda de una pregunta
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const borradorResumen = z
  .object({
    id: opaqueId,
    estado: estadoBorrador,
    cuantasRespondidas: z.number().int().nonnegative(),
    puedeCerrarse: z.boolean(),
    frase: fraseDeCierre,
    cerradoEn: instantMs.optional(),
  })
  .strict();
export type BorradorResumenDto = z.infer<typeof borradorResumen>;

export const borradorDetalle = z
  .object({
    id: opaqueId,
    estado: estadoBorrador,
    cerradoEn: instantMs.optional(),
    cuantasRespondidas: z.number().int().nonnegative(),
    puedeCerrarse: z.boolean(),
    huecos: z.array(huecoPregunta),
    desajustes: z.array(desajustePregunta),
    frase: fraseDeCierre,
    /** La versión vigente de cada pregunta respondida, con su procedencia. No la historia entera. */
    procedencia: z.array(procedenciaDeRespuesta),
    /** Las que existieron, aplicadas o no: lo no aplicado se sabe por ausencia en `aplicadas`. */
    sugerencias: z.array(sugerenciaRegistrada),
    aplicadas: z.array(opaqueId),
    consentimiento: consentimientoVigente.optional(),
    sePuedePedirConsentimiento: z.boolean(),
    modo: modoAsistente,
    /** Presente sólo si `modo` es `'estructural'`. */
    motivoEstructural: motivoEstructural.optional(),
    porQueNoHaySugerencias: z.string().optional(),
    /** La primera pregunta sin responder desde el principio, o ausente si no queda ninguna. */
    siguiente: numeroPregunta.optional(),
  })
  .strict();
export type BorradorDetalleDto = z.infer<typeof borradorDetalle>;

/** `GET /asistente/borradores/:id/preguntas/:numero`. Una pregunta por pantalla, con su ayuda. */
export const ayudaPregunta = z
  .object({
    pregunta: preguntaAsistente,
    rotulo: z.string(),
    loQueYaEscribiste: versionRespuesta.optional(),
    muestraMemoria: z.boolean(),
    huecos: z.array(huecoPregunta),
    desajustes: z.array(desajustePregunta),
    frase: fraseDeCierre,
    siguiente: numeroPregunta.optional(),
    modo: modoAsistente,
    /** Presente sólo si `modo` es `'estructural'`: qué decirle a la persona y por qué. */
    porQueNoHaySugerencias: z.string().optional(),
  })
  .strict();
export type AyudaPreguntaDto = z.infer<typeof ayudaPregunta>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Mensajes de error, en castellano llano y sin la jerga del motor (ADR-0041)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Traducción de los códigos que puede lanzar el dominio del asistente.
 *
 * Vive aquí —junto al resto del vocabulario de esta pantalla— por el mismo motivo que
 * `MENSAJES_DELIBERACION` vive en `http.ts`: la capa HTTP la usa como respaldo antes del mensaje
 * crudo del dominio, que puede llevar palabras como «evento» o «seq» —vocabulario del motor, no de
 * esta pantalla—. `packages/contracts/test/asistente.test.ts` comprueba que ninguna frase de aquí
 * lleva una palabra de `FORBIDDEN_UI_TERMS`.
 *
 * **Nota para quien integre `services/api/src/http/rutas-asistente.ts`:** ese fichero trae hoy una
 * copia local de esta misma tabla, porque `packages/contracts/src/index.ts` todavía no reexporta
 * este módulo (ver el informe de la tarea). En cuanto se añada `export * from './asistente.js';`
 * ahí, la copia local puede borrarse e importarse esta.
 */
export const MENSAJES_ASISTENTE: Readonly<Record<string, string>> = {
  DRAFT_NOT_OPEN: 'No encontramos ese borrador. Puede que el enlace esté viejo: empezá uno nuevo.',
  NOT_THE_AUTHOR:
    'Este borrador es de otra persona: cada quien ve y escribe sólo el suyo. Si querés escribir ' +
    'sobre lo mismo, empezá el tuyo.',
  ANSWER_SHAPE_MISMATCH:
    'Esa pregunta se responde de otra forma. Recargá la pregunta y volvé a intentarlo.',
  EMPTY_ANSWER: 'Escribí al menos una línea, o marcá «todavía no sé».',
  TOO_MANY_LINES: `Son demasiadas líneas; el máximo son ${String(MAX_LINEAS)}.`,
  NOTHING_TO_ENUMERATE:
    'Todavía no hay nada que enumerar acá: respondé primero la pregunta de la que sale esta lista.',
  LINE_COUNT_MISMATCH:
    'Esta lista ya no tiene tantas líneas como la pregunta que enumera. Recargá la pregunta antes ' +
    'de volver a guardar.',
  DUPLICATE_SUGGESTION:
    'Esa sugerencia ya estaba registrada. Recargá la pregunta y probá de nuevo.',
  FORBIDDEN_AI_OPERATION: 'Eso no es algo que el ayudante automático pueda hacer.',
  UNKNOWN_AI_OPERATION: 'No reconocemos esa forma de ayuda. Recargá la pregunta y probá de nuevo.',
  NO_CONSENT_FOR_DESTINATION:
    'Todavía no dijiste si tu texto puede salir de acá para pedir ayuda. Contestá esa pregunta primero.',
  EMPTY_SUGGESTION: 'El ayudante no propuso nada esta vez. Podés seguir escribiendo a mano.',
  SUGGESTION_NOT_TEXT:
    'El ayudante automático devolvió algo que no podemos usar. Probá de nuevo, o seguí escribiendo ' +
    'a mano: no se perdió nada de lo que ya tenías.',
  AI_SUGGESTION_WITH_POWER:
    'El ayudante automático devolvió algo que no podemos usar. Probá de nuevo, o seguí escribiendo ' +
    'a mano: no se perdió nada de lo que ya tenías.',
  UNKNOWN_SUGGESTION:
    'Esa sugerencia ya no está disponible. Puede que el borrador se haya actualizado: recargá la ' +
    'pregunta.',
  SUGGESTION_ALREADY_APPLIED:
    'Esa sugerencia ya se usó una vez. Recargá la pregunta para ver cómo quedó.',
  SUGGESTION_SCOPE_MISMATCH: 'Esa sugerencia era para otra pregunta. Recargá y probá de nuevo.',
  CANNOT_SUGGEST_IGNORANCE:
    '«Todavía no sé» lo decidís vos, escribiéndolo directamente; no es algo que se tome de una sugerencia.',
  TEXT_NOT_IN_SUGGESTION:
    'Ese texto no es exactamente el que propuso el ayudante. Si lo cambiaste, guardalo escribiéndolo ' +
    'directamente: queda a tu nombre igual.',
  MANDATORY_ANSWERS_MISSING:
    'Todavía faltan la 1 o la 11 para poder cerrar: son las dos únicas obligatorias.',
  AI_NOT_AVAILABLE:
    'El ayudante automático no está disponible ahora mismo. Podés seguir con las 27 preguntas igual.',
  AI_IDENTITY_LEAK:
    'Ese texto no puede salir de acá tal cual porque parece llevar algo que identifica a alguien o ' +
    'a este mismo borrador. Editalo y probá de nuevo.',
  INVALID_ID: 'No encontramos eso. Puede que el enlace esté viejo o que se haya movido.',
  ILLEGAL_TRANSITION:
    'Ese borrador ya está cerrado, o todavía no existe. Si querés corregir algo, empezá otro.',
};

/** Frase para un código del asistente. Si el código es desconocido, una frase honesta y no el código. */
export function mensajeDeAsistente(codigo: string, respaldo?: string): string {
  return (
    MENSAJES_ASISTENTE[codigo] ??
    respaldo ??
    'No pudimos completar esa acción y no se escribió nada. Volvé a cargar la pregunta y probá de ' +
      'nuevo; si vuelve a pasar, contalo en el grupo.'
  );
}
