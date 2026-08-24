/**
 * Rutas del **asistente de acción sistémica** (ADR-0052).
 *
 * Expone `packages/domain/src/assistant/`: 2.813 líneas de dominio probado que hasta ahora no tenía
 * ruta, contrato ni pantalla. Aquí sólo se traduce JSON a órdenes del dominio y estado del dominio a
 * JSON — exactamente lo que hace `app.ts` con el resto de las rutas, y con el mismo reparto: **esta
 * capa no decide nada.** La autoría la comprueba el pliegue (`assertEsElAutor`); la forma de cada
 * respuesta, el consentimiento y el cotejo de una sugerencia aplicada también los comprueba el
 * pliegue. Lo único que se decide aquí es **de quién es el borrador que se está mirando**, porque eso
 * el dominio no lo sabe: un borrador es un historial de eventos y no tiene ACL propia (ADR-0052,
 * «consecuencias negativas aceptadas» — la autoría de los actos se comprueba en el pliegue, no en
 * `access.ts`, porque no hay un `ResourceKind` `'borrador'`). Aquí se aplica esa misma regla para la
 * **lectura**: sólo quien abrió un borrador puede verlo o escribir en él.
 *
 * ═══ Cómo se integra, sin tocar `app.ts` ═══
 *
 * `registrarRutasDeAsistente(app, ctx)` añade las rutas a una instancia de Fastify ya construida.
 * `ContextoAsistente` es exactamente lo que estas rutas necesitan del ámbito de `buildApp` — ni una
 * cosa más—: el puerto de IA (o su ausencia, que es el valor por defecto legítimo del ADR), quién
 * llama, el mismo ayudante de cupo de escritura que usan las demás rutas de escritura, y la
 * persistencia del historial de cada borrador. Quien integre esto en `app.ts` construye `ctx` a
 * partir de `options.ports`, `actorDe`/`idDe`/`cupoDeEscritura` (ya existen ahí) y un almacén nuevo
 * para `governance.event` con `aggregate_type = 'assistant'` — el mismo patrón que
 * `services/api/src/workspace/repository.ts` usa para problemas, propuestas e iniciativas, con un
 * códec de seis tipos de evento en vez de los que ya hay.
 *
 * ═══ Por qué las rutas de escritura traducen los errores del dominio ellas mismas ═══
 *
 * El manejador de errores compartido de `app.ts` traduce un `DomainError` genérico con
 * `MENSAJES_DELIBERACION[code] ?? error.message` — una tabla que vive en `packages/contracts/src/
 * http.ts`, un fichero que este agente no toca. Los códigos de este dominio no están en esa tabla, así
 * que caerían al mensaje crudo del dominio, y algunos de esos mensajes llevan vocabulario del motor
 * («evento», «seq») que ADR-0041 prohíbe en pantalla. Por eso `traducirError` intercepta los códigos
 * conocidos y responde ella misma, **antes** de que el error llegue al manejador compartido; lo que no
 * reconoce lo deja pasar, y cae en el mismo 422 genérico que ya usa el resto de la aplicación.
 *
 * ═══ Sobre la copia local de mensajes ═══
 *
 * `packages/contracts/src/asistente.ts` ya trae `MENSAJES_ASISTENTE`, la tabla canónica. Este fichero
 * trae una copia porque `packages/contracts/src/index.ts` —fichero compartido, fuera de mi alcance—
 * todavía no hace `export * from './asistente.js'`. En cuanto alguien añada esa línea, `ERRORES_
 * CONOCIDOS` de aquí abajo puede construirse a partir de la tabla importada y esta nota se borra. Los
 * esquemas de Zod de las órdenes tienen la misma historia: son un duplicado deliberado y pequeño de
 * los de `packages/contracts/src/asistente.ts`, por la misma razón.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  type AIAssistantPort,
  type AssistantEvent,
  type AssistantLog,
  type AssistantState,
  type BorradorId,
  type DestinoIA,
  type DisponibilidadIA,
  type MemberId,
  type NumeroPregunta,
  type Pregunta,
  type ProcedenciaDeRespuesta,
  type PuertoDeIA,
  type Respuesta,
  type SugerenciaId,
  type VersionDeRespuesta,
  aplicarSugerencia,
  applyAssistant,
  abrirBorrador,
  ayudaEstructural,
  borradorId as toBorradorId,
  cerrarBorrador,
  construirPeticion,
  CUANTAS_PREGUNTAS,
  cuantasRespondidas as cuantasRespondidasDe,
  decidirConsentimiento,
  DomainError,
  desajustes as desajustesDe,
  escribirRespuesta,
  esNumeroDePregunta,
  eventId,
  fraseDeCierre,
  huecos as huecosDe,
  initialAssistantState,
  instant,
  MAX_LINEAS,
  MAX_TEXTO_SUGERIDO,
  modoDelAsistente,
  motivoEstructural,
  normalizeLedgerText,
  OPERACIONES,
  PREGUNTAS,
  PreconditionError,
  procedencia as procedenciaDe,
  puedeCerrarse as puedeCerrarseDe,
  registrarSugerencia,
  sePuedePedirConsentimiento as sePuedePedirConsentimientoDe,
  SIN_IA,
  sugerenciaId as toSugerenciaId,
  TEXTO_DEL_MOTIVO,
  TITULO_DE_GRUPO,
  verifyAssistantLog,
} from '@koinonia/domain';

const PREFIJO = '/asistente';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lo que estas rutas necesitan del ámbito de `buildApp`, y nada más
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ContextoAsistente {
  /** El puerto de IA configurado, o su ausencia. `undefined` es un valor legítimo (ADR-0052 §e). */
  readonly puertoIA: PuertoDeIA;
  /** A dónde iría el texto si hay proveedor. `undefined` cuando `puertoIA` también lo es. */
  readonly destinoIA: DestinoIA | undefined;
  /** Milisegundos desde el epoch UTC. El mismo reloj que usa el resto de `buildApp`. */
  readonly ahora: () => number;
  /** Un identificador opaco de 128 bits (32 hex). La misma fuente de azar que usa el resto. */
  readonly idOpaco: () => string;
  /** Quién llama. `undefined` sin sesión vigente — el mismo criterio que `idDe` en `app.ts`. */
  readonly actorId: (request: FastifyRequest) => MemberId | undefined;
  /** El mismo ayudante de cupo de escritura de las demás rutas de escritura. */
  readonly cupoDeEscritura: (request: FastifyRequest) => Promise<void>;
  /** El historial completo de un borrador, en orden de `seq`. Arreglo vacío si nunca se abrió. */
  readonly cargarBorrador: (id: BorradorId) => Promise<AssistantLog>;
  /** Persiste el evento que acaba de sellar una orden, ya encadenado sobre el log cargado. */
  readonly guardarEvento: (id: BorradorId, evento: AssistantEvent) => Promise<void>;
  /** Los borradores que abrió esta persona, para «retomar donde se dejó». Cualquier orden sirve. */
  readonly listarPropios: (actor: MemberId) => Promise<readonly BorradorId[]>;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Esquemas de entrada (copia local; ver la nota de cabecera)
// ═════════════════════════════════════════════════════════════════════════════════════════════

const textoDeRespuesta = z.string().min(1).max(MAX_TEXTO_SUGERIDO);

const respuestaBody = z.discriminatedUnion('forma', [
  z.object({ forma: z.literal('frase'), texto: textoDeRespuesta }).strict(),
  z
    .object({
      forma: z.literal('lineas'),
      lineas: z.array(textoDeRespuesta).min(1).max(MAX_LINEAS),
    })
    .strict(),
  z
    .object({
      forma: z.literal('por_linea'),
      porLinea: z.array(textoDeRespuesta).min(1).max(MAX_LINEAS),
    })
    .strict(),
  z.object({ forma: z.literal('todavia_no_se') }).strict(),
]);
type RespuestaBody = z.infer<typeof respuestaBody>;

const numeroDePreguntaBody = z.number().int().min(1).max(CUANTAS_PREGUNTAS);

const cuerpoEscribirRespuesta = z
  .object({ pregunta: numeroDePreguntaBody, respuesta: respuestaBody })
  .strict();

const cuerpoAplicarSugerencia = cuerpoEscribirRespuesta;

const cuerpoDecidirConsentimiento = z.object({ concedido: z.boolean() }).strict();

const cuerpoPedirSugerencia = z
  .object({
    operacion: z.enum(OPERACIONES),
    pregunta: numeroDePreguntaBody.optional(),
    fragmento: z.string().min(1).max(MAX_TEXTO_SUGERIDO),
    conQueComparar: z.array(z.string().min(1).max(MAX_TEXTO_SUGERIDO)).max(20).optional(),
  })
  .strict();

const paramId = z.object({ id: z.string() });
const paramIdYNumero = z.object({ id: z.string(), numero: z.coerce.number() });
const paramIdYSugerencia = z.object({ id: z.string(), sugerenciaId: z.string() });

function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

/** Normaliza cada campo de texto (NFC, sin retorno de carro) antes de que el dominio lo vea. */
function normalizarRespuesta(r: RespuestaBody): Respuesta {
  switch (r.forma) {
    case 'frase':
      return { forma: 'frase', texto: normalizeLedgerText(r.texto) };
    case 'lineas':
      return { forma: 'lineas', lineas: r.lineas.map(normalizeLedgerText) };
    case 'por_linea':
      return { forma: 'por_linea', porLinea: r.porLinea.map(normalizeLedgerText) };
    case 'todavia_no_se':
      return { forma: 'todavia_no_se' };
  }
}

/** El número validado por Zod (1..27), como el tipo cerrado que exige el dominio. Nunca falla. */
function comoNumeroPregunta(valor: number): NumeroPregunta {
  if (!esNumeroDePregunta(valor)) {
    throw new PreconditionError(
      'UNKNOWN_QUESTION',
      `no existe la pregunta ${String(valor)}: el formulario tiene 27`,
    );
  }
  return valor;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Errores: los códigos del dominio del asistente, traducidos aquí (ver la nota de cabecera)
// ═════════════════════════════════════════════════════════════════════════════════════════════

interface ApiErrorLocal {
  readonly codigo: string;
  readonly mensaje: string;
  readonly queHacer?: string;
}

interface TraduccionError {
  readonly estado: number;
  readonly mensaje: string;
  readonly queHacer?: string;
}

const ERRORES_CONOCIDOS: ReadonlyMap<string, TraduccionError> = new Map([
  [
    'DRAFT_NOT_OPEN',
    { estado: 404, mensaje: 'No encontramos ese borrador. Puede que el enlace esté viejo.' },
  ],
  [
    'NOT_THE_AUTHOR',
    {
      estado: 403,
      mensaje: 'Este borrador es de otra persona: cada quien ve y escribe sólo el suyo.',
    },
  ],
  [
    'ANSWER_SHAPE_MISMATCH',
    {
      estado: 422,
      mensaje: 'Esa pregunta se responde de otra forma. Recargá la pregunta y probá de nuevo.',
    },
  ],
  [
    'EMPTY_ANSWER',
    { estado: 422, mensaje: 'Escribí al menos una línea, o marcá «todavía no sé».' },
  ],
  [
    'TOO_MANY_LINES',
    { estado: 422, mensaje: `Son demasiadas líneas; el máximo son ${String(MAX_LINEAS)}.` },
  ],
  [
    'NOTHING_TO_ENUMERATE',
    {
      estado: 409,
      mensaje:
        'Todavía no hay nada que enumerar acá: respondé primero la pregunta de la que sale esta lista.',
    },
  ],
  [
    'LINE_COUNT_MISMATCH',
    {
      estado: 409,
      mensaje:
        'Esta lista ya no tiene tantas líneas como la pregunta que enumera. Recargá la pregunta ' +
        'antes de volver a guardar.',
    },
  ],
  [
    'DUPLICATE_SUGGESTION',
    {
      estado: 409,
      mensaje: 'Esa sugerencia ya estaba registrada. Recargá la pregunta y probá de nuevo.',
    },
  ],
  [
    'FORBIDDEN_AI_OPERATION',
    { estado: 422, mensaje: 'Eso no es algo que el ayudante automático pueda hacer.' },
  ],
  [
    'UNKNOWN_AI_OPERATION',
    {
      estado: 422,
      mensaje: 'No reconocemos esa forma de ayuda. Recargá la pregunta y probá de nuevo.',
    },
  ],
  ['UNKNOWN_QUESTION', { estado: 404, mensaje: 'No encontramos esa pregunta.' }],
  [
    'NO_CONSENT_FOR_DESTINATION',
    {
      estado: 409,
      mensaje:
        'Todavía no dijiste si tu texto puede salir de acá para pedir ayuda. Contestá esa pregunta primero.',
    },
  ],
  [
    'EMPTY_SUGGESTION',
    {
      estado: 422,
      mensaje: 'El ayudante no propuso nada esta vez. Podés seguir escribiendo a mano.',
    },
  ],
  [
    'SUGGESTION_NOT_TEXT',
    {
      estado: 502,
      mensaje:
        'El ayudante automático devolvió algo que no podemos usar. Probá de nuevo, o seguí ' +
        'escribiendo a mano: no se perdió nada de lo que ya tenías.',
    },
  ],
  [
    'AI_SUGGESTION_WITH_POWER',
    {
      estado: 502,
      mensaje:
        'El ayudante automático devolvió algo que no podemos usar. Probá de nuevo, o seguí ' +
        'escribiendo a mano: no se perdió nada de lo que ya tenías.',
    },
  ],
  [
    'UNKNOWN_SUGGESTION',
    {
      estado: 404,
      mensaje: 'Esa sugerencia ya no está disponible. Puede que el borrador se haya actualizado.',
    },
  ],
  [
    'SUGGESTION_ALREADY_APPLIED',
    {
      estado: 409,
      mensaje: 'Esa sugerencia ya se usó una vez. Recargá la pregunta para ver cómo quedó.',
    },
  ],
  [
    'SUGGESTION_SCOPE_MISMATCH',
    { estado: 422, mensaje: 'Esa sugerencia era para otra pregunta. Recargá y probá de nuevo.' },
  ],
  [
    'CANNOT_SUGGEST_IGNORANCE',
    {
      estado: 422,
      mensaje:
        '«Todavía no sé» lo decidís vos, escribiéndolo directamente; no es algo que se tome de una sugerencia.',
    },
  ],
  [
    'TEXT_NOT_IN_SUGGESTION',
    {
      estado: 422,
      mensaje:
        'Ese texto no es exactamente el que propuso el ayudante. Si lo cambiaste, guardalo ' +
        'escribiéndolo directamente: queda a tu nombre igual.',
    },
  ],
  [
    'MANDATORY_ANSWERS_MISSING',
    {
      estado: 422,
      mensaje: 'Todavía faltan la 1 o la 11 para poder cerrar: son las dos únicas obligatorias.',
    },
  ],
  [
    'AI_NOT_AVAILABLE',
    {
      estado: 409,
      mensaje:
        'El ayudante automático no está disponible ahora mismo. Podés seguir con las 27 preguntas igual.',
    },
  ],
  [
    'AI_IDENTITY_LEAK',
    {
      estado: 422,
      mensaje:
        'Ese texto no puede salir de acá tal cual porque parece llevar algo que identifica a alguien ' +
        'o a este mismo borrador. Editalo y probá de nuevo.',
    },
  ],
  [
    'ILLEGAL_TRANSITION',
    {
      estado: 409,
      mensaje:
        'Ese borrador ya está cerrado, o todavía no existe. Si querés corregir algo, empezá otro.',
    },
  ],
  [
    'INVALID_ID',
    {
      estado: 404,
      mensaje: 'No encontramos eso. Puede que el enlace esté viejo o que se haya movido.',
    },
  ],
]);

function traducirError(
  error: unknown,
): { readonly estado: number; readonly cuerpo: ApiErrorLocal } | undefined {
  if (!(error instanceof DomainError)) return undefined;
  const traduccion = ERRORES_CONOCIDOS.get(error.code);
  if (traduccion === undefined) return undefined;
  return {
    estado: traduccion.estado,
    cuerpo: {
      codigo: error.code,
      mensaje: traduccion.mensaje,
      ...(traduccion.queHacer === undefined ? {} : { queHacer: traduccion.queHacer }),
    },
  };
}

/** Ejecuta una tarea de ruta; si lanza un error conocido del asistente, responde ella misma. */
async function manejar(reply: FastifyReply, tarea: () => Promise<unknown>): Promise<unknown> {
  try {
    return await tarea();
  } catch (error) {
    const traducido = traducirError(error);
    if (traducido === undefined) throw error;
    return await reply.status(traducido.estado).send(traducido.cuerpo);
  }
}

function errorSinSesion(): ApiErrorLocal {
  return {
    codigo: 'UNAUTHORIZED_NOT_AUTHENTICATED',
    mensaje: 'Para hacer esto hay que entrar con el correo institucional. Tu borrador se conserva.',
  };
}

function errorNoEncontrado(): ApiErrorLocal {
  return {
    codigo: 'NO_ENCONTRADO',
    mensaje: 'No encontramos eso. Puede que el enlace esté viejo o que se haya movido.',
  };
}

function errorNoEsTuyo(): ApiErrorLocal {
  return {
    codigo: 'UNAUTHORIZED_NOT_THE_OWNER',
    mensaje: 'Este borrador es de otra persona: cada quien ve y escribe sólo el suyo.',
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Resolver de quién es el borrador — la única autorización que decide esta capa (ver cabecera)
// ═════════════════════════════════════════════════════════════════════════════════════════════

interface BorradorResuelto {
  readonly log: AssistantLog;
  readonly estado: AssistantState;
  readonly actor: MemberId;
}

async function resolverBorrador(
  ctx: ContextoAsistente,
  request: FastifyRequest,
  reply: FastifyReply,
  id: BorradorId,
): Promise<BorradorResuelto | undefined> {
  const actor = ctx.actorId(request);
  if (actor === undefined) {
    await reply.status(401).send(errorSinSesion());
    return undefined;
  }
  const log = await ctx.cargarBorrador(id);
  const estado = await verifyAssistantLog(id, log);
  if (!estado.existe) {
    await reply.status(404).send(errorNoEncontrado());
    return undefined;
  }
  if (estado.autor !== actor) {
    await reply.status(403).send(errorNoEsTuyo());
    return undefined;
  }
  return { log, estado, actor };
}

function disponibilidad(ctx: ContextoAsistente): DisponibilidadIA {
  return ctx.puertoIA === undefined || ctx.destinoIA === undefined
    ? SIN_IA
    : { hayProveedor: true, destino: ctx.destinoIA };
}

function metaDePersona(
  ctx: ContextoAsistente,
  actor: MemberId,
): {
  readonly eventId: ReturnType<typeof eventId>;
  readonly occurredAt: ReturnType<typeof instant>;
  readonly actor: MemberId;
} {
  return { eventId: eventId(ctx.idOpaco()), occurredAt: instant(ctx.ahora()), actor };
}

function metaDeSistema(ctx: ContextoAsistente): {
  readonly eventId: ReturnType<typeof eventId>;
  readonly occurredAt: ReturnType<typeof instant>;
} {
  return { eventId: eventId(ctx.idOpaco()), occurredAt: instant(ctx.ahora()) };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Del dominio a la pantalla
// ═════════════════════════════════════════════════════════════════════════════════════════════

function preguntaDto(p: Pregunta) {
  return {
    numero: p.numero,
    grupo: p.grupo,
    rotuloGrupo: TITULO_DE_GRUPO[p.grupo],
    texto: p.texto,
    forma: p.forma,
    obligatoria: p.obligatoria,
    ...(p.porCadaLineaDe === undefined ? {} : { porCadaLineaDe: p.porCadaLineaDe }),
    muestraMemoria: p.muestraMemoria,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T-25 (`docs/THREAT_MODEL.md`): la marca visible del contenido asistido
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// El dominio ya distingue, evento a evento, si una respuesta se escribió a mano (`RespuestaEscrita`)
// o se tomó de una sugerencia (`SugerenciaAplicada`) — es `VersionDeRespuesta.origen` y
// `ProcedenciaDeRespuesta.origen`, y de ahí se puede reconstruir años después, leyendo el historial,
// qué escribió una persona y qué le propuso la máquina (ver la cabecera de
// `packages/domain/src/assistant/types.ts`, sección «Procedencia sin vigilancia»).
//
// Lo que falta es la bandera **con el nombre que promete el modelo de amenaza**: `assisted: true`,
// para que ninguna pantalla ni ningún cliente tenga que conocer la regla `origen === 'sugerencia'`
// para mostrar la marca. Estos dos mapeos añaden esa bandera al cruzar la frontera HTTP, sin
// inventar un dato nuevo — es el mismo `origen`, dicho con el nombre correcto.

/** Añade `assisted` a una versión de respuesta. Ver la nota de arriba. */
function versionRespuestaDto(version: VersionDeRespuesta) {
  return { ...version, assisted: version.origen === 'sugerencia' };
}

/** Añade `assisted` a cada entrada de la procedencia. Ver la nota de arriba. */
function procedenciaDto(lista: readonly ProcedenciaDeRespuesta[]) {
  return lista.map((p) => ({ ...p, assisted: p.origen === 'sugerencia' }));
}

function borradorResumenDto(estado: AssistantState) {
  const frase = fraseDeCierre(estado);
  return {
    id: estado.borradorId,
    estado: estado.estado,
    cuantasRespondidas: cuantasRespondidasDe(estado),
    puedeCerrarse: puedeCerrarseDe(estado),
    frase: {
      texto: frase.texto,
      huecos: frase.huecos,
      completa: frase.completa,
      pregunta: frase.pregunta,
    },
    ...(estado.cerradoEn === undefined ? {} : { cerradoEn: estado.cerradoEn }),
  };
}

function borradorDetalleDto(estado: AssistantState, disp: DisponibilidadIA) {
  const modo = modoDelAsistente(estado, disp);
  const motivo = motivoEstructural(estado, disp);
  const frase = fraseDeCierre(estado);
  const listaHuecos = huecosDe(estado);
  const siguiente = listaHuecos[0]?.pregunta;
  return {
    id: estado.borradorId,
    estado: estado.estado,
    ...(estado.cerradoEn === undefined ? {} : { cerradoEn: estado.cerradoEn }),
    cuantasRespondidas: cuantasRespondidasDe(estado),
    puedeCerrarse: puedeCerrarseDe(estado),
    huecos: listaHuecos,
    desajustes: desajustesDe(estado),
    frase: {
      texto: frase.texto,
      huecos: frase.huecos,
      completa: frase.completa,
      pregunta: frase.pregunta,
    },
    procedencia: procedenciaDto(procedenciaDe(estado)),
    sugerencias: estado.sugerencias,
    aplicadas: estado.aplicadas,
    ...(estado.consentimiento === undefined
      ? {}
      : {
          consentimiento: {
            concedido: estado.consentimiento.concedido,
            destino: estado.consentimiento.destino,
            decididoEn: estado.consentimiento.decididoEn,
          },
        }),
    sePuedePedirConsentimiento: sePuedePedirConsentimientoDe(estado),
    modo,
    ...(motivo === undefined ? {} : { motivoEstructural: motivo }),
    ...(motivo === undefined ? {} : { porQueNoHaySugerencias: TEXTO_DEL_MOTIVO[motivo] }),
    ...(siguiente === undefined ? {} : { siguiente }),
  };
}

function ayudaPreguntaDto(estado: AssistantState, numero: NumeroPregunta, ctx: ContextoAsistente) {
  const disp = disponibilidad(ctx);
  const ayuda = ayudaEstructural(estado, numero, disp);
  const modo = modoDelAsistente(estado, disp);
  const motivo = motivoEstructural(estado, disp);
  return {
    pregunta: preguntaDto(ayuda.pregunta),
    rotulo: ayuda.rotulo,
    ...(ayuda.loQueYaEscribiste === undefined
      ? {}
      : { loQueYaEscribiste: versionRespuestaDto(ayuda.loQueYaEscribiste) }),
    muestraMemoria: ayuda.muestraMemoria,
    huecos: ayuda.huecos,
    desajustes: ayuda.desajustes,
    frase: {
      texto: ayuda.frase.texto,
      huecos: ayuda.frase.huecos,
      completa: ayuda.frase.completa,
      pregunta: ayuda.frase.pregunta,
    },
    ...(ayuda.siguiente === undefined ? {} : { siguiente: ayuda.siguiente }),
    modo,
    ...(motivo === undefined ? {} : { porQueNoHaySugerencias: TEXTO_DEL_MOTIVO[motivo] }),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Pedir ayuda a la IA: un switch exhaustivo por operación, para que cada rama quede tipada con la
// forma exacta que devuelve `AIAssistantPort` — nunca `unknown` ensanchado a la fuerza.
// ═════════════════════════════════════════════════════════════════════════════════════════════

interface SugerenciaRecibidaResultado {
  readonly evento: AssistantEvent;
  readonly dto: unknown;
}

async function pedirYRegistrar(
  ctx: ContextoAsistente,
  puerto: AIAssistantPort,
  id: BorradorId,
  log: AssistantLog,
  operacion: (typeof OPERACIONES)[number],
  peticion: {
    readonly operacion: (typeof OPERACIONES)[number];
    readonly fragmento: string;
    readonly conQueComparar: readonly string[];
  },
  pregunta: NumeroPregunta | undefined,
  destino: DestinoIA,
): Promise<SugerenciaRecibidaResultado> {
  const nuevoId = toSugerenciaId(ctx.idOpaco());
  const meta = metaDeSistema(ctx);
  const base = { sugerenciaId: nuevoId, ...(pregunta === undefined ? {} : { pregunta }), destino };
  switch (operacion) {
    case 'estructurar': {
      const s = await puerto.estructurar(peticion);
      const evento = await registrarSugerencia(id, log, { ...base, sugerencia: s, pregunta }, meta);
      return { evento, dto: { operacion, ...base, contenido: s.contenido } };
    }
    case 'resumir': {
      const s = await puerto.resumir(peticion);
      const evento = await registrarSugerencia(id, log, { ...base, sugerencia: s, pregunta }, meta);
      return { evento, dto: { operacion, ...base, contenido: s.contenido } };
    }
    case 'buscar_parecidos': {
      const s = await puerto.buscarParecidos(peticion);
      const evento = await registrarSugerencia(id, log, { ...base, sugerencia: s, pregunta }, meta);
      return { evento, dto: { operacion, ...base, contenido: s.contenido } };
    }
    case 'senalar_contradicciones': {
      const s = await puerto.senalarContradicciones(peticion);
      const evento = await registrarSugerencia(id, log, { ...base, sugerencia: s, pregunta }, meta);
      return { evento, dto: { operacion, ...base, contenido: s.contenido } };
    }
    case 'proponer_alternativas': {
      const s = await puerto.proponerAlternativas(peticion);
      const evento = await registrarSugerencia(id, log, { ...base, sugerencia: s, pregunta }, meta);
      return { evento, dto: { operacion, ...base, contenido: s.contenido } };
    }
    case 'partir_en_tareas': {
      const s = await puerto.partirEnTareas(peticion);
      const evento = await registrarSugerencia(id, log, { ...base, sugerencia: s, pregunta }, meta);
      return { evento, dto: { operacion, ...base, contenido: s.contenido } };
    }
    case 'explicar_una_regla': {
      const s = await puerto.explicarUnaRegla(peticion);
      const evento = await registrarSugerencia(id, log, { ...base, sugerencia: s, pregunta }, meta);
      return { evento, dto: { operacion, ...base, contenido: s.contenido } };
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Las rutas
// ═════════════════════════════════════════════════════════════════════════════════════════════

export function registrarRutasDeAsistente(app: FastifyInstance, ctx: ContextoAsistente): void {
  // ── Catálogo: las 27 preguntas, públicas y estáticas ────────────────────────────────────────
  app.get(`${PREFIJO}/preguntas`, () => PREGUNTAS.map(preguntaDto));

  // ── Empezar ──────────────────────────────────────────────────────────────────────────────────
  app.post(`${PREFIJO}/borradores`, async (request, reply) =>
    manejar(reply, async () => {
      await ctx.cupoDeEscritura(request);
      const actor = ctx.actorId(request);
      if (actor === undefined) return await reply.status(401).send(errorSinSesion());
      const id = toBorradorId(ctx.idOpaco());
      const log: AssistantLog = [];
      const evento = await abrirBorrador(id, log, metaDePersona(ctx, actor));
      await ctx.guardarEvento(id, evento);
      const estado = applyAssistant(initialAssistantState(id), evento);
      return await reply.status(201).send(borradorDetalleDto(estado, disponibilidad(ctx)));
    }),
  );

  // ── Retomar: los borradores propios ─────────────────────────────────────────────────────────
  app.get(`${PREFIJO}/borradores`, async (request, reply) =>
    manejar(reply, async () => {
      const actor = ctx.actorId(request);
      if (actor === undefined) return await reply.status(401).send(errorSinSesion());
      const ids = await ctx.listarPropios(actor);
      const resumenes = [];
      for (const id of ids) {
        const log = await ctx.cargarBorrador(id);
        const estado = await verifyAssistantLog(id, log);
        if (estado.existe) resumenes.push(borradorResumenDto(estado));
      }
      return resumenes;
    }),
  );

  app.get(`${PREFIJO}/borradores/:id`, async (request, reply) =>
    manejar(reply, async () => {
      const { id: raw } = parse(paramId, request.params);
      const id = toBorradorId(raw);
      const resuelto = await resolverBorrador(ctx, request, reply, id);
      if (resuelto === undefined) return undefined;
      return borradorDetalleDto(resuelto.estado, disponibilidad(ctx));
    }),
  );

  // ── Una pregunta por pantalla ───────────────────────────────────────────────────────────────
  app.get(`${PREFIJO}/borradores/:id/preguntas/:numero`, async (request, reply) =>
    manejar(reply, async () => {
      const { id: raw, numero: crudo } = parse(paramIdYNumero, request.params);
      const id = toBorradorId(raw);
      const resuelto = await resolverBorrador(ctx, request, reply, id);
      if (resuelto === undefined) return undefined;
      const numero = comoNumeroPregunta(crudo);
      return ayudaPreguntaDto(resuelto.estado, numero, ctx);
    }),
  );

  // ── Contestar una pregunta ──────────────────────────────────────────────────────────────────
  app.post(`${PREFIJO}/borradores/:id/respuestas`, async (request, reply) =>
    manejar(reply, async () => {
      await ctx.cupoDeEscritura(request);
      const { id: raw } = parse(paramId, request.params);
      const id = toBorradorId(raw);
      const resuelto = await resolverBorrador(ctx, request, reply, id);
      if (resuelto === undefined) return undefined;
      const cuerpo = parse(cuerpoEscribirRespuesta, request.body);
      const numero = comoNumeroPregunta(cuerpo.pregunta);
      const respuesta = normalizarRespuesta(cuerpo.respuesta);
      const evento = await escribirRespuesta(
        id,
        resuelto.log,
        { pregunta: numero, respuesta },
        metaDePersona(ctx, resuelto.actor),
      );
      await ctx.guardarEvento(id, evento);
      const estado = applyAssistant(resuelto.estado, evento);
      return await reply.status(201).send(ayudaPreguntaDto(estado, numero, ctx));
    }),
  );

  // ── Consentimiento antes de que nada salga hacia un tercero ────────────────────────────────
  app.post(`${PREFIJO}/borradores/:id/consentimiento`, async (request, reply) =>
    manejar(reply, async () => {
      await ctx.cupoDeEscritura(request);
      const { id: raw } = parse(paramId, request.params);
      const id = toBorradorId(raw);
      const resuelto = await resolverBorrador(ctx, request, reply, id);
      if (resuelto === undefined) return undefined;
      const cuerpo = parse(cuerpoDecidirConsentimiento, request.body);
      const destino = ctx.destinoIA;
      if (destino === undefined) {
        return await reply.status(409).send({
          codigo: 'AI_NOT_AVAILABLE',
          mensaje: 'Acá no hay ningún ayudante automático conectado: no hay nada que consentir.',
        } satisfies ApiErrorLocal);
      }
      const evento = await decidirConsentimiento(
        id,
        resuelto.log,
        { concedido: cuerpo.concedido, destino },
        metaDePersona(ctx, resuelto.actor),
      );
      await ctx.guardarEvento(id, evento);
      const estado = applyAssistant(resuelto.estado, evento);
      return borradorDetalleDto(estado, disponibilidad(ctx));
    }),
  );

  // ── Pedir ayuda a la IA ──────────────────────────────────────────────────────────────────────
  app.post(`${PREFIJO}/borradores/:id/sugerencias`, async (request, reply) =>
    manejar(reply, async () => {
      await ctx.cupoDeEscritura(request);
      const { id: raw } = parse(paramId, request.params);
      const id = toBorradorId(raw);
      const resuelto = await resolverBorrador(ctx, request, reply, id);
      if (resuelto === undefined) return undefined;
      const cuerpo = parse(cuerpoPedirSugerencia, request.body);
      const disp = disponibilidad(ctx);
      const pregunta =
        cuerpo.pregunta === undefined ? undefined : comoNumeroPregunta(cuerpo.pregunta);
      const peticion = construirPeticion(resuelto.estado, disp, {
        operacion: cuerpo.operacion,
        fragmento: normalizeLedgerText(cuerpo.fragmento),
        conQueComparar: cuerpo.conQueComparar?.map(normalizeLedgerText),
      });
      const puerto = ctx.puertoIA;
      const destino = disp.destino;
      // Defensivo: `construirPeticion` sólo devuelve si el modo es generativo, y eso exige las dos
      // cosas. Si esto lanzara, sería un error de este fichero, no una respuesta del dominio.
      if (puerto === undefined || destino === undefined) {
        throw new PreconditionError('AI_NOT_AVAILABLE', 'modo generativo sin puerto o destino');
      }
      const { evento, dto } = await pedirYRegistrar(
        ctx,
        puerto,
        id,
        resuelto.log,
        cuerpo.operacion,
        peticion,
        pregunta,
        destino,
      );
      await ctx.guardarEvento(id, evento);
      return await reply.status(201).send(dto);
    }),
  );

  // ── Tomar una sugerencia ────────────────────────────────────────────────────────────────────
  app.post(`${PREFIJO}/borradores/:id/sugerencias/:sugerenciaId/aplicar`, async (request, reply) =>
    manejar(reply, async () => {
      await ctx.cupoDeEscritura(request);
      const { id: raw, sugerenciaId: rawSid } = parse(paramIdYSugerencia, request.params);
      const id = toBorradorId(raw);
      const sid: SugerenciaId = toSugerenciaId(rawSid);
      const resuelto = await resolverBorrador(ctx, request, reply, id);
      if (resuelto === undefined) return undefined;
      const cuerpo = parse(cuerpoAplicarSugerencia, request.body);
      const numero = comoNumeroPregunta(cuerpo.pregunta);
      const respuesta = normalizarRespuesta(cuerpo.respuesta);
      const evento = await aplicarSugerencia(
        id,
        resuelto.log,
        { sugerenciaId: sid, pregunta: numero, respuesta },
        metaDePersona(ctx, resuelto.actor),
      );
      await ctx.guardarEvento(id, evento);
      const estado = applyAssistant(resuelto.estado, evento);
      return ayudaPreguntaDto(estado, numero, ctx);
    }),
  );

  // ── Cerrar ───────────────────────────────────────────────────────────────────────────────────
  app.post(`${PREFIJO}/borradores/:id/cerrar`, async (request, reply) =>
    manejar(reply, async () => {
      await ctx.cupoDeEscritura(request);
      const { id: raw } = parse(paramId, request.params);
      const id = toBorradorId(raw);
      const resuelto = await resolverBorrador(ctx, request, reply, id);
      if (resuelto === undefined) return undefined;
      const evento = await cerrarBorrador(id, resuelto.log, metaDePersona(ctx, resuelto.actor));
      await ctx.guardarEvento(id, evento);
      const estado = applyAssistant(resuelto.estado, evento);
      return borradorDetalleDto(estado, disponibilidad(ctx));
    }),
  );
}
