/**
 * El contrato HTTP completo: una sola definición para el servidor y para el cliente.
 *
 * `services/api` valida **con estos mismos esquemas** en la entrada, y `apps/web` los usa para tipar
 * las respuestas. Una sola fuente de verdad: si un campo cambia aquí, el cliente deja de compilar,
 * que es exactamente lo que se quiere. La alternativa —dos declaraciones que hay que acordarse de
 * mantener a la par— produce el fallo silencioso favorito de las API internas.
 *
 * **La validación del cliente no es una garantía.** Todo lo que se valida aquí se vuelve a validar
 * en el servidor, y todo lo que se autoriza se autoriza en el dominio (`@koinonia/domain/access`).
 * `tests/e2e` llama a la API **saltándose la interfaz** precisamente para demostrarlo.
 */

import { z } from 'zod';
import {
  CONTRIBUTION_KINDS,
  DELIBERATION_STAGES,
  MIN_CONTRIBUTION_LENGTH,
  OUTCOME_CRITERION_EVIDENCE,
  POSITION_MODES,
  REASON_RELATIONS,
  TASK_BLOCK_CATEGORIES,
  TASK_CHANGE_REASONS,
  TASK_EVIDENCE_KIND_CODES,
  TASK_EVIDENCE_SIZE_CLASSES,
  TASK_EVIDENCE_VISIBILITIES,
  TASK_HELP_CATEGORIES,
  TASK_RESPONSE_REASONS,
} from '@koinonia/domain';

import { apiError } from './errors.js';
import { email, hash64, instantMs, opaqueId, requestId } from './ids.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Sesión
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const rol = z.enum(['observer', 'member', 'facilitator', 'guarantees', 'tech-admin']);
export type Rol = z.infer<typeof rol>;

export const solicitudEnlace = z.object({ correo: email });
export type SolicitudEnlace = z.infer<typeof solicitudEnlace>;

export const respuestaEnlace = z.object({
  /** Siempre `true`, exista o no la cuenta: la respuesta no revela quién está registrado. */
  enviado: z.literal(true),
  /** Cuántos minutos dura el enlace. Se dice en pantalla; los plazos no se ocultan. */
  duraMinutos: z.number().int().positive(),
  /**
   * Sólo en desarrollo, con el adaptador de correo de consola: el enlace, para no tener que leer
   * los registros del servidor. En producción nunca viaja.
   */
  enlaceDeDesarrollo: z.string().optional(),
});
export type RespuestaEnlace = z.infer<typeof respuestaEnlace>;

export const canjeEnlace = z.object({ token: z.string().min(20).max(512) });
export type CanjeEnlace = z.infer<typeof canjeEnlace>;

export const sesion = z.object({
  miembroId: opaqueId,
  /** Nombre para saludar. Sale del correo, nunca del historial: el historial no guarda personas. */
  alias: z.string(),
  roles: z.array(rol),
  circulos: z.array(opaqueId),
  expiraEn: instantMs,
});
export type Sesion = z.infer<typeof sesion>;

export const baseLegalSupresion = z.enum(['ley-1581-art-8e', 'revocatoria-consentimiento']);
export type BaseLegalSupresion = z.infer<typeof baseLegalSupresion>;

/** No existe selector de sujeto: la persona se deriva de una sesión recién autenticada. */
export const solicitarSupresion = z
  .object({
    requestId,
    baseLegal: baseLegalSupresion,
    confirmacionIrreversible: z.literal(true),
  })
  .strict();
export type SolicitarSupresion = z.infer<typeof solicitarSupresion>;

export const supresionSolicitada = z
  .object({
    solicitudId: opaqueId,
    radicado: opaqueId,
    solicitadaEn: instantMs,
    estado: z.literal('pendiente'),
  })
  .strict();
export type SupresionSolicitada = z.infer<typeof supresionSolicitada>;

/**
 * Vista autenticada y mínima para elegir una persona del mismo círculo. No es un directorio:
 * deliberadamente no lleva correo, roles, semestre ni otros datos que no hagan falta al dropdown.
 */
export const miembroCirculo = z.object({
  id: opaqueId,
  alias: z.string().min(1).max(120),
});
export type MiembroCirculo = z.infer<typeof miembroCirculo>;

export const miembrosCirculo = z.array(miembroCirculo);
export type MiembrosCirculo = z.infer<typeof miembrosCirculo>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Problemas
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const estadoProblema = z.enum([
  'recogiendo-evidencia',
  'con-propuesta',
  'resuelto',
  'archivado',
]);
export type EstadoProblema = z.infer<typeof estadoProblema>;

/**
 * Cómo se dice cada estado en pantalla. **Una sola regla**, y por eso está acá.
 *
 * La lista y el detalle decían el mismo estado de dos formas distintas: la lista lo buscaba en una
 * tabla propia («Recogiendo evidencia») y el detalle se limitaba a cambiar los guiones por espacios
 * («recogiendo evidencia»). Dos redacciones del mismo hecho hacen dudar de si son el mismo hecho,
 * que es exactamente lo que esta pantalla no se puede permitir.
 */
export const ESTADO_PROBLEMA_EN_PALABRAS: Readonly<Record<EstadoProblema, string>> = {
  'recogiendo-evidencia': 'Recogiendo evidencia',
  'con-propuesta': 'Ya tiene propuesta',
  resuelto: 'Resuelto',
  archivado: 'Archivado',
};

export const certeza = z.enum(['visto', 'me-lo-contaron', 'lo-supongo']);
export type Certeza = z.infer<typeof certeza>;

/** Cómo se dice cada grado de certeza en pantalla. */
export const CERTEZA_EN_PALABRAS: Readonly<Record<Certeza, string>> = {
  visto: 'Lo vi',
  'me-lo-contaron': 'Me lo contaron',
  'lo-supongo': 'Lo estoy suponiendo',
};

export const crearProblema = z.object({
  requestId,
  titulo: z
    .string()
    .min(10, 'Contá en una frase qué está pasando que no debería estar pasando.')
    .max(140, 'Un título más corto se lee mejor en un teléfono.'),
  cuerpo: z
    .string()
    .min(30, 'Contá el hecho concreto que te lo hizo ver.')
    .max(4000, 'Quedó muy largo. Lo demás podés aportarlo como evidencia.'),
  circuloId: opaqueId,
});
export type CrearProblema = z.infer<typeof crearProblema>;

export const aportarEvidencia = z.object({
  requestId,
  certeza,
  cuerpo: z.string().min(20, 'Un aporte necesita algo más que una línea.').max(4000),
  fuente: z.string().max(140).optional(),
});
export type AportarEvidencia = z.infer<typeof aportarEvidencia>;

export const retirarEvidencia = z.object({
  requestId,
  motivo: z.string().min(10, 'Retirar deja constancia del hueco y del motivo.').max(400),
});
export type RetirarEvidencia = z.infer<typeof retirarEvidencia>;

export const evidencia = z.object({
  id: opaqueId,
  certeza,
  cuerpo: z.string(),
  fuente: z.string().optional(),
  cuando: instantMs,
  /** `true` si es tuya. Lo decide el servidor; el cliente no puede afirmarlo. */
  esMia: z.boolean(),
  retirada: z.object({ cuando: instantMs, motivo: z.string() }).optional(),
});
export type Evidencia = z.infer<typeof evidencia>;

export const problemaResumen = z.object({
  id: opaqueId,
  titulo: z.string(),
  estado: estadoProblema,
  circuloId: opaqueId,
  desde: instantMs,
  lesPasaLoMismo: z.number().int().nonnegative(),
  aportes: z.number().int().nonnegative(),
  propuestas: z.number().int().nonnegative(),
});
export type ProblemaResumen = z.infer<typeof problemaResumen>;

export const problemaDetalle = problemaResumen.extend({
  cuerpo: z.string(),
  evidencias: z.array(evidencia),
  /** `true` si ya dijiste que te pasa lo mismo. */
  yaDijeQueMePasa: z.boolean(),
  /** `true` si vos lo escribiste. */
  esMio: z.boolean(),
});
export type ProblemaDetalle = z.infer<typeof problemaDetalle>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Propuestas
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const criterioExito = z.object({
  descripcion: z.string().min(20).max(500),
  fuenteDeVerificacion: z.string().min(5).max(500),
});
export type CriterioExito = z.infer<typeof criterioExito>;

export const planEjecucion = z.object({
  objetivo: z.string().min(20).max(1000),
  responsableId: opaqueId,
  revisarEn: instantMs,
  criteriosDeExito: z.array(criterioExito).min(1).max(10),
});
export type PlanEjecucion = z.infer<typeof planEjecucion>;

export const crearPropuesta = z.object({
  requestId,
  problemaId: opaqueId,
  titulo: z.string().min(10).max(140),
  cuerpo: z.string().min(50, 'Una propuesta necesita decir qué se hace, concretamente.').max(4000),
  plan: planEjecucion,
});
export type CrearPropuesta = z.infer<typeof crearPropuesta>;

export const enmendarPropuesta = z.object({
  requestId,
  titulo: z.string().min(10).max(140),
  cuerpo: z.string().min(50).max(4000),
  motivo: z.string().min(20, 'Decí qué cambia y por qué.').max(1000),
  plan: planEjecucion,
});
export type EnmendarPropuesta = z.infer<typeof enmendarPropuesta>;

export const versionPropuesta = z.object({
  version: z.number().int().positive(),
  titulo: z.string(),
  cuerpo: z.string(),
  /**
   * La huella del texto y el plan exactos. En pantalla **no se llama así**: se muestra como
   * «comprobante de esta versión» y se explica en una frase (PRODUCT §7).
   */
  huella: hash64,
  cuando: instantMs,
  motivo: z.string().optional(),
  /** Ausente sólo en versiones históricas creadas antes de que el plan fuera obligatorio. */
  plan: planEjecucion.optional(),
});
export type VersionPropuesta = z.infer<typeof versionPropuesta>;

export const propuestaResumen = z.object({
  id: opaqueId,
  problemaId: opaqueId,
  circuloId: opaqueId,
  titulo: z.string(),
  versionVigente: z.number().int().positive(),
  esMia: z.boolean(),
  decisiones: z.array(z.object({ decisionId: opaqueId, huella: hash64 })),
});
export type PropuestaResumen = z.infer<typeof propuestaResumen>;

export const propuestaDetalle = propuestaResumen.extend({
  /** **Todas** las versiones, de la 1 en adelante. Ninguna se sobrescribe jamás. */
  versiones: z.array(versionPropuesta),
  problemaTitulo: z.string(),
});
export type PropuestaDetalle = z.infer<typeof propuestaDetalle>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Decisiones
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Los dos métodos del MVP (PRODUCT §9), con los nombres del motor. */
export const metodo = z.enum(['simple-majority', 'sociocratic-consent']);
export type Metodo = z.infer<typeof metodo>;

export const abrirDecision = z.object({
  requestId,
  propuestaId: opaqueId,
  /** Versión exacta que se somete. Si se omite, la vigente. */
  version: z.number().int().positive().optional(),
  metodo,
  /** Cuántas horas dura la ventana. Se muestra siempre en pantalla. */
  duracionHoras: z.number().int().min(1).max(720),
});
export type AbrirDecision = z.infer<typeof abrirDecision>;

export const posturaConsentimiento = z.enum(['consent', 'concern', 'object']);
export type PosturaConsentimiento = z.infer<typeof posturaConsentimiento>;

/** Cómo se dice cada postura en pantalla. Nunca «voto sí / voto no». */
export const POSTURA_EN_PALABRAS: Readonly<Record<PosturaConsentimiento, string>> = {
  consent: 'Sin objeción',
  concern: 'Tengo una reserva',
  object: 'Objeto',
};

export const emitirPapeleta = z.object({
  requestId,
  /** Versión del texto que la persona tenía a la vista. El servidor la compara con la vigente. */
  huellaVersion: hash64,
  respuesta: z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('binary'), aprueba: z.boolean() }),
    z.object({ tipo: z.literal('abstain') }),
    z.object({
      tipo: z.literal('consent'),
      postura: posturaConsentimiento,
      objecion: z
        .object({
          argumento: z
            .string()
            .min(40, 'Bloquear a la comunidad tiene que costar, como mínimo, explicarse.')
            .max(4000),
          objetivoDanado: z.string().min(5, 'Decí qué objetivo del grupo se daña.').max(400),
          enmiendaPropuesta: z.string().max(4000).optional(),
        })
        .optional(),
    }),
  ]),
});
export type EmitirPapeleta = z.infer<typeof emitirPapeleta>;

export const estadoDecision = z.enum([
  'Inexistent',
  'Draft',
  'Open',
  'Closed',
  'Tallied',
  'Ratified',
  'Rejected',
  'Annulled',
]);
export type EstadoDecision = z.infer<typeof estadoDecision>;

export const decisionResumen = z.object({
  id: opaqueId,
  propuestaId: opaqueId,
  titulo: z.string(),
  estado: estadoDecision,
  metodo,
  abreEn: instantMs,
  cierraEn: instantMs,
  /** Huella de la versión sometida. En pantalla, «el texto que se está decidiendo». */
  huellaVersion: hash64,
  /** Cuántas personas podían decidir aquí. Se congela al abrir y no cambia. */
  podianDecidir: z.number().int().nonnegative(),
  seManifestaron: z.number().int().nonnegative(),
  /** Qué hace falta para que esto pase, en palabras. Va SIEMPRE en la papeleta. */
  queHaceFaltaParaQuePase: z.string(),
});
export type DecisionResumen = z.infer<typeof decisionResumen>;

export const decisionDetalle = decisionResumen.extend({
  cuerpoVersion: z.string(),
  /** Ausente únicamente en decisiones históricas; toda decisión nueva lo congela al abrir. */
  plan: planEjecucion.optional(),
  /** Si vos podías decidir aquí. Falso para quien no estaba en la lista congelada. */
  puedoDecidir: z.boolean(),
  /** Tu respuesta vigente, si emitiste alguna. Se puede cambiar hasta el cierre. */
  miRespuesta: z.string().optional(),
  motivoNoPuedo: z.string().optional(),
});
export type DecisionDetalle = z.infer<typeof decisionDetalle>;

export const pasoTraza = z.object({
  id: z.string(),
  /** La frase en castellano común. Es lo que se muestra. */
  explicacion: z.string(),
  datos: z.record(z.string(), z.union([z.string(), z.number()])),
});
export type PasoTraza = z.infer<typeof pasoTraza>;

export const tablaTraza = z.object({
  titulo: z.string(),
  columnas: z.array(z.string()),
  filas: z.array(z.array(z.union([z.string(), z.number()]))),
});
export type TablaTraza = z.infer<typeof tablaTraza>;

export const desenlace = z.enum(['approved', 'rejected', 'no-quorum', 'needs-new-round']);
export type Desenlace = z.infer<typeof desenlace>;

/** Cómo se dice cada desenlace. Nunca el identificador. */
export const DESENLACE_EN_PALABRAS: Readonly<Record<Desenlace, string>> = {
  approved: 'Aprobada',
  rejected: 'No aprobada',
  'no-quorum': 'Sin participación suficiente',
  'needs-new-round': 'Vuelve a discutirse',
};

export const resultadoDecision = z.object({
  decisionId: opaqueId,
  /**
   * El título de lo que se decidió.
   *
   * La pantalla encabezaba con «Resultado» a secas: quien llega desde un enlace compartido —que es
   * como llega casi todo el mundo— veía un veredicto sin saber de qué. Un resultado sin su asunto
   * no se puede ni citar ni discutir.
   */
  titulo: z.string(),
  /** Presente únicamente cuando el cierre aprobado creó su iniciativa. */
  iniciativaId: opaqueId.optional(),
  desenlace,
  desenlaceEnPalabras: z.string(),
  /** Por qué salió lo que salió, en una frase larga y sin jerga. */
  relato: z.string(),
  pasos: z.array(pasoTraza),
  tablas: z.array(tablaTraza),
  participacion: z.object({
    emitidas: z.number().int().nonnegative(),
    representadas: z.number().int().nonnegative(),
    podianDecidir: z.number().int().nonnegative(),
  }),
  /** Comprobante del resultado. En pantalla: «el comprobante de este resultado». */
  comprobante: hash64,
  /** Comprobante de las reglas congeladas al abrir. */
  comprobanteReglas: hash64,
  /** Comprobante de la lista de quiénes podían decidir. */
  comprobanteLista: hash64,
});
export type ResultadoDecision = z.infer<typeof resultadoDecision>;

/** La ratificación abre la ejecución sólo después de la ventana de impugnación. */
export const ratificarDecision = z.object({ requestId });
export type RatificarDecision = z.infer<typeof ratificarDecision>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Capacidad privada
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * La ausencia no se convierte en cero: cero es una declaración válida y tiene una revisión.
 * El discriminante evita que un cliente invente valores por defecto cuando todavía no hay dato.
 */
export const capacidadPropia = z.discriminatedUnion('declarada', [
  z.object({ declarada: z.literal(false) }).strict(),
  z
    .object({
      declarada: z.literal(true),
      revision: z.number().int().positive(),
      minutosPorSemana: z.number().int().min(0).max(10_080),
      updatedAt: instantMs,
    })
    .strict(),
]);
export type CapacidadPropia = z.infer<typeof capacidadPropia>;

/**
 * CAS de la capacidad propia. `revision: 0` significa «crear sólo si sigue ausente»; una fila
 * existente exige presentar su revisión exacta. Es estricto para que `memberId` (o cualquier otra
 * forma de direccionar a otra persona) sea un error de frontera y no un campo silenciosamente
 * ignorado.
 */
export const actualizarCapacidad = z
  .object({
    revision: z.number().int().min(0).max(2_147_483_646),
    minutosPorSemana: z.number().int().min(0).max(10_080),
  })
  .strict();
export type ActualizarCapacidad = z.infer<typeof actualizarCapacidad>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Iniciativas
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const estadoIniciativa = z.enum(['por-empezar']);
export type EstadoIniciativa = z.infer<typeof estadoIniciativa>;

/** Estados visibles: una oferta no atribuye trabajo hasta que la persona la acepta. */
export const estadoTarea = z.enum([
  'ofrecida',
  'aceptada',
  'rechazada',
  'reasignacion-solicitada',
  'en-curso',
  'bloqueada',
  'en-apoyo',
  'entregada',
  'completada',
]);
export type EstadoTarea = z.infer<typeof estadoTarea>;

export const planificarHito = z.object({
  requestId,
  titulo: z.string().min(10).max(140),
  criterioDeTerminacion: z.string().min(20).max(500),
  venceEn: instantMs,
});
export type PlanificarHito = z.infer<typeof planificarHito>;

export const ofrecerTarea = z.object({
  requestId,
  hitoId: opaqueId,
  destinatarioId: opaqueId,
  titulo: z.string().min(10).max(140),
  descripcion: z.string().min(20).max(4000),
  venceEn: instantMs,
  esfuerzoMinutos: z.number().int().min(1).max(10_080),
  /** Son identificadores, nunca nombres; el dominio comprueba existencia, propia tarea y ciclos. */
  dependeDe: z
    .array(opaqueId)
    .max(50)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      'Una dependencia sólo puede aparecer una vez.',
    ),
});
export type OfrecerTarea = z.infer<typeof ofrecerTarea>;

export const motivoRespuestaTarea = z.enum(TASK_RESPONSE_REASONS);
export type MotivoRespuestaTarea = z.infer<typeof motivoRespuestaTarea>;

export const MOTIVO_RESPUESTA_TAREA_EN_PALABRAS: Readonly<Record<MotivoRespuestaTarea, string>> = {
  'sin-disponibilidad': 'No tengo disponibilidad para asumirla',
  'plazo-inviable': 'No puedo cumplir el plazo propuesto',
  'alcance-no-claro': 'Necesito que se aclare o divida la tarea',
  'otra-persona-mas-adecuada': 'Otra persona puede asumirla mejor',
  'razon-privada': 'Prefiero no publicar el motivo',
};

const respuestaOfertaBase = z.object({
  requestId,
  offerId: opaqueId,
  /** CAS opaco: el cliente lo devuelve, pero nunca tiene que mostrárselo a la persona. */
  revision: z.number().int().positive(),
});
/** `offerId` evita que una respuesta retrasada acepte una oferta que ya fue reemplazada. */
export const responderOfertaTarea = z.discriminatedUnion('tipo', [
  respuestaOfertaBase.extend({ tipo: z.literal('aceptar') }),
  respuestaOfertaBase.extend({
    tipo: z.literal('rechazar'),
    motivo: motivoRespuestaTarea,
  }),
  respuestaOfertaBase.extend({
    tipo: z.literal('pedir-reasignacion'),
    motivo: motivoRespuestaTarea,
  }),
]);
export type ResponderOfertaTarea = z.infer<typeof responderOfertaTarea>;

/** La oferta vigente que se reemplaza evita una reoferta tardía después de otra reasignación. */
export const reofrecerTarea = z.object({ requestId, offerId: opaqueId, destinatarioId: opaqueId });
export type ReofrecerTarea = z.infer<typeof reofrecerTarea>;

const mutacionTareaBase = z
  .object({
    requestId,
    offerId: opaqueId,
    revision: z.number().int().positive(),
  })
  .strict();

export const iniciarTarea = mutacionTareaBase;
export type IniciarTarea = z.infer<typeof iniciarTarea>;

export const categoriaBloqueoTarea = z.enum(TASK_BLOCK_CATEGORIES);
export type CategoriaBloqueoTarea = z.infer<typeof categoriaBloqueoTarea>;
export const CATEGORIA_BLOQUEO_EN_PALABRAS: Readonly<Record<CategoriaBloqueoTarea, string>> = {
  dependencia: 'Dependo de otra tarea o persona',
  recurso: 'Falta un recurso',
  'respuesta-externa': 'Falta una respuesta externa',
  alcance: 'El alcance necesita aclararse',
  'razon-privada': 'Prefiero no publicar la causa',
};

export const bloquearTarea = mutacionTareaBase
  .extend({ categoria: categoriaBloqueoTarea })
  .strict();
export type BloquearTarea = z.infer<typeof bloquearTarea>;

export const categoriaAyudaTarea = z.enum(TASK_HELP_CATEGORIES);
export type CategoriaAyudaTarea = z.infer<typeof categoriaAyudaTarea>;
export const CATEGORIA_AYUDA_EN_PALABRAS: Readonly<Record<CategoriaAyudaTarea, string>> = {
  desbloqueo: 'Necesito ayuda para destrabarla',
  revision: 'Necesito que alguien revise conmigo',
  'trabajo-compartido': 'Necesito compartir parte del trabajo',
  orientacion: 'Necesito orientación',
  'razon-privada': 'Prefiero no publicar el motivo',
};

export const pedirAyudaTarea = mutacionTareaBase
  .extend({ categoria: categoriaAyudaTarea })
  .strict();
export type PedirAyudaTarea = z.infer<typeof pedirAyudaTarea>;

export const reanudarTarea = mutacionTareaBase.extend({ pauseId: opaqueId }).strict();
export type ReanudarTarea = z.infer<typeof reanudarTarea>;

/**
 * Corte inicial: una nota textual restringida. No se acepta nombre de archivo, MIME, URL, tamaño,
 * nonce ni commitment; el servidor clasifica y compromete lo que realmente almacenó.
 */
export const agregarEvidenciaTarea = mutacionTareaBase
  .extend({
    contenido: z.string().min(10).max(16_384),
    visibilidad: z.literal('restricted'),
  })
  .strict();
export type AgregarEvidenciaTarea = z.infer<typeof agregarEvidenciaTarea>;

export const aperturaMaterialRestringido = z.object({ contenido: z.string().max(16_384) }).strict();
export type AperturaMaterialRestringido = z.infer<typeof aperturaMaterialRestringido>;

export const entregarTarea = mutacionTareaBase
  .extend({
    evidenciaIds: z
      .array(opaqueId)
      .min(1)
      .max(50)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'Una evidencia sólo se referencia una vez.',
      ),
    resumen: z.string().min(20).max(4000),
  })
  .strict();
export type EntregarTarea = z.infer<typeof entregarTarea>;

export const motivoCambiosTarea = z.enum(TASK_CHANGE_REASONS);
export type MotivoCambiosTarea = z.infer<typeof motivoCambiosTarea>;
export const MOTIVO_CAMBIOS_EN_PALABRAS: Readonly<Record<MotivoCambiosTarea, string>> = {
  'criterio-no-cumplido': 'Todavía no cumple el criterio acordado',
  'evidencia-insuficiente': 'La evidencia todavía no permite verificarlo',
  'alcance-incompleto': 'Falta una parte del alcance acordado',
  'razon-privada': 'Hay un detalle que debe tratarse por el canal privado',
};

export const pedirCambiosTarea = z
  .object({
    requestId,
    deliveryId: opaqueId,
    revision: z.number().int().positive(),
    motivo: motivoCambiosTarea,
  })
  .strict();
export type PedirCambiosTarea = z.infer<typeof pedirCambiosTarea>;

export const evidenciaCriterioResultado = z.enum(OUTCOME_CRITERION_EVIDENCE);
export type EvidenciaCriterioResultado = z.infer<typeof evidenciaCriterioResultado>;
export const EVIDENCIA_CRITERIO_EN_PALABRAS: Readonly<Record<EvidenciaCriterioResultado, string>> =
  {
    verificada: 'La evidencia permite verificar esta entrega',
    'sin-verificar': 'La entrega se acepta, pero la evidencia no pudo verificarse',
    'no-aplica': 'Este encargo no requería esa clase de verificación',
  };

export const aceptarRevisionTarea = z
  .object({
    requestId,
    deliveryId: opaqueId,
    revision: z.number().int().positive(),
    evidenciaCriterio: evidenciaCriterioResultado,
  })
  .strict();
export type AceptarRevisionTarea = z.infer<typeof aceptarRevisionTarea>;

export const hito = z.object({
  id: opaqueId,
  titulo: z.string(),
  criterioDeTerminacion: z.string(),
  venceEn: instantMs,
  planificadoEn: instantMs,
});
export type Hito = z.infer<typeof hito>;

export const causaFinPausaTarea = z.enum(['reanudacion', 'reasignacion']);
export type CausaFinPausaTarea = z.infer<typeof causaFinPausaTarea>;

export const pausaTarea = z
  .object({
    id: opaqueId,
    tipo: z.enum(['bloqueo', 'apoyo']),
    categoria: z.union([categoriaBloqueoTarea, categoriaAyudaTarea]),
    iniciadaEn: instantMs,
    finalizadaEn: instantMs.optional(),
    causaDeFin: causaFinPausaTarea.optional(),
  })
  .refine(
    (pausa) => (pausa.finalizadaEn === undefined) === (pausa.causaDeFin === undefined),
    'Una pausa histórica debe presentar juntas la fecha y la causa de finalización.',
  );
export type PausaTarea = z.infer<typeof pausaTarea>;

export const solicitudAyudaTarea = z.object({
  id: opaqueId,
  pausaId: opaqueId,
  categoria: categoriaAyudaTarea,
  solicitadaEn: instantMs,
});
export type SolicitudAyudaTarea = z.infer<typeof solicitudAyudaTarea>;

export const evidenciaTarea = z.object({
  id: opaqueId,
  tipo: z.enum(TASK_EVIDENCE_KIND_CODES),
  tamano: z.enum(TASK_EVIDENCE_SIZE_CLASSES),
  visibilidad: z.enum(TASK_EVIDENCE_VISIBILITIES),
  agregadaEn: instantMs,
  /** Autoriza mostrar el control; la ruta vuelve a comprobar y no confía en este booleano. */
  puedeAbrirse: z.boolean(),
});
export type EvidenciaTarea = z.infer<typeof evidenciaTarea>;

export const revisionEntregaTarea = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('cambios-solicitados'),
    motivo: motivoCambiosTarea,
    revisadaEn: instantMs,
  }),
  z.object({
    tipo: z.literal('aceptada'),
    evidenciaCriterio: evidenciaCriterioResultado,
    revisadaEn: instantMs,
  }),
]);
export type RevisionEntregaTarea = z.infer<typeof revisionEntregaTarea>;

export const entregaTarea = z.object({
  id: opaqueId,
  evidenciaIds: z.array(opaqueId),
  entregadaEn: instantMs,
  /** Autoriza mostrar el control; la ruta vuelve a comprobar y no confía en este booleano. */
  puedeAbrirse: z.boolean(),
  revision: revisionEntregaTarea.optional(),
});
export type EntregaTarea = z.infer<typeof entregaTarea>;

export const tarea = z.object({
  id: opaqueId,
  hitoId: opaqueId,
  destinatarioId: opaqueId,
  /** Sólo existe después de aceptar; una oferta todavía no obliga a nadie. */
  responsableId: opaqueId.optional(),
  ofertaId: opaqueId,
  /** Revisión opaca para que dos respuestas construidas sobre la misma vista no escriban ambas. */
  revision: z.number().int().positive(),
  titulo: z.string(),
  descripcion: z.string(),
  venceEn: instantMs,
  esfuerzoMinutos: z.number().int().positive(),
  dependeDe: z.array(opaqueId),
  estado: estadoTarea,
  iniciadaEn: instantMs.optional(),
  /** Historia completa; `pausaActual` sólo facilita operar sobre la pausa vigente. */
  pausas: z.array(pausaTarea),
  pausaActual: pausaTarea.optional(),
  solicitudesDeAyuda: z.array(solicitudAyudaTarea),
  evidencias: z.array(evidenciaTarea),
  entregas: z.array(entregaTarea),
  entregaActualId: opaqueId.optional(),
  completadaEn: instantMs.optional(),
  /** El servidor lo calcula contra la sesión; no se muestra el nombre de otra persona. */
  esMia: z.boolean(),
});
export type Tarea = z.infer<typeof tarea>;

export const iniciativaResumen = z.object({
  id: opaqueId,
  decisionId: opaqueId,
  propuestaId: opaqueId,
  circuloId: opaqueId,
  objetivo: z.string(),
  responsableId: opaqueId,
  revisarEn: instantMs,
  criteriosDeExito: z.array(criterioExito),
  estado: estadoIniciativa,
  creadaEn: instantMs,
  comprobanteDecision: hash64,
  comprobanteVersion: hash64,
  /** Una iniciativa aprobada permanece provisional hasta que vence la impugnación y se ratifica. */
  activa: z.boolean(),
  /** Plazo derivado de la decisión, no un campo retroescrito dentro del stream de iniciativa. */
  ratificableEn: instantMs.optional(),
  activadaEn: instantMs.optional(),
  /** No es un nombre: habilita acciones del plan sin revelar identidad personal. */
  esResponsableInicial: z.boolean(),
});
export type IniciativaResumen = z.infer<typeof iniciativaResumen>;

export const iniciativaDetalle = iniciativaResumen.extend({
  /** El proyector convierte la ausencia histórica en listas vacías; la UI nunca infiere `undefined`. */
  hitos: z.array(hito),
  tareas: z.array(tarea),
});
export type IniciativaDetalle = z.infer<typeof iniciativaDetalle>;

/**
 * Una tarea **propia**, con lo justo para decidir qué hacer con ella.
 *
 * `GET /mi/tareas` existe porque «Mis tareas» se armaba pidiendo `/iniciativas`, es decir, el
 * detalle completo de todas las iniciativas del Instituto: el título y la descripción del trabajo
 * de todo el mundo viajaban al teléfono de cualquiera y se quedaban en memoria, y el `esMia` que
 * parecía filtrar era sólo una condición de pintado. Con datos móviles contados eso además se paga.
 *
 * `dependenciasPendientes` es **un número y no una lista de títulos** a propósito. La pantalla sólo
 * necesita saber si puede empezar y cuánto falta; los nombres de esas tareas se leen en la
 * iniciativa, que es donde ese trabajo se rinde en público. Un endpoint propio que devolviera
 * títulos ajenos no sería un endpoint propio.
 */
export const miTarea = z.object({
  iniciativaId: opaqueId,
  /** El objetivo de la iniciativa: sitúa la tarea sin obligar a otra petición. */
  objetivo: z.string(),
  tarea,
  dependenciasPendientes: z.number().int().nonnegative(),
});
export type MiTarea = z.infer<typeof miTarea>;

export const misTareas = z.array(miTarea);
export type MisTareas = z.infer<typeof misTareas>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Deliberación
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Las seis ventanas de escritura. Los identificadores son los del motor y **nunca** se muestran:
 * en pantalla se dicen con `ETAPA_EN_PALABRAS`, que es la lista que manda ADR-0041.
 */
export const etapaDeliberacion = z.enum(DELIBERATION_STAGES);
export type EtapaDeliberacion = z.infer<typeof etapaDeliberacion>;

/** Cómo se llama cada etapa en pantalla. Una palabra, la que usa la gente. */
export const ETAPA_EN_PALABRAS: Readonly<Record<EtapaDeliberacion, string>> = {
  preguntas_aclaratorias: 'Preguntas',
  perspectivas: 'Perspectivas',
  construccion_alternativas: 'Alternativas',
  objeciones: 'Objeciones',
  enmiendas: 'Enmiendas',
  listo_para_decidir: 'Listo para decidir',
};

/** Para qué sirve cada etapa, en una frase. Va siempre visible: una etapa sin propósito es un rótulo. */
export const ETAPA_PARA_QUE_SIRVE: Readonly<Record<EtapaDeliberacion, string>> = {
  preguntas_aclaratorias:
    'Primero se entiende el problema. Acá se pregunta lo que no está claro y se responde.',
  perspectivas:
    'Acá cada quien dice cómo ve el problema y por qué. Todavía no se proponen soluciones.',
  construccion_alternativas: 'Con lo dicho, se arman salidas concretas al problema.',
  objeciones: 'Acá se dice qué puede salir mal en cada salida propuesta, y qué tan grave sería.',
  enmiendas: 'Cada salida se corrige para responder a lo que se objetó.',
  listo_para_decidir: 'Acá ya no se escribe. Lo que sigue es una decisión.',
};

/** Los seis tipos de aporte. También son identificadores del motor: en pantalla, la tabla de abajo. */
export const tipoAporte = z.enum(CONTRIBUTION_KINDS);
export type TipoAporte = z.infer<typeof tipoAporte>;

export const TIPO_APORTE_EN_PALABRAS: Readonly<Record<TipoAporte, string>> = {
  posicion: 'Postura',
  razon: 'Razón',
  evidencia: 'Dato que lo respalda',
  supuesto: 'Supuesto',
  riesgo: 'Riesgo',
  alternativa: 'Salida propuesta',
};

/** Preguntar y afirmar no son el mismo acto y no caben en la misma ventana. */
export const modoPosicion = z.enum(POSITION_MODES);
export type ModoPosicion = z.infer<typeof modoPosicion>;

export const MODO_POSICION_EN_PALABRAS: Readonly<Record<ModoPosicion, string>> = {
  pregunta_aclaratoria: 'Pregunta',
  afirmacion: 'Postura',
};

/** Una razón o responde a una pregunta, o sostiene una postura. Nunca las dos cosas. */
export const relacionRazon = z.enum(REASON_RELATIONS);
export type RelacionRazon = z.infer<typeof relacionRazon>;

export const RELACION_RAZON_EN_PALABRAS: Readonly<Record<RelacionRazon, string>> = {
  responde: 'Responde a',
  sostiene: 'Sostiene',
};

/** Gravedad declarada de un riesgo. Sin valor por defecto: hay que decirlo. */
export const gravedadRiesgo = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type GravedadRiesgo = z.infer<typeof gravedadRiesgo>;

export const GRAVEDAD_EN_PALABRAS: Readonly<Record<GravedadRiesgo, string>> = {
  1: 'Molesta, pero se sigue',
  2: 'Estorba a algunas personas',
  3: 'Estorba a todo el grupo',
  4: 'Deja el asunto sin resolver',
  5: 'Hace daño difícil de deshacer',
};

/**
 * Lo que de verdad se puede escribir, que **no es lo mismo que el tipo de aporte**.
 *
 * En `Preguntas` y en `Perspectivas` el motor admite las dos veces un aporte de tipo `posicion`, y
 * sin embargo son actos distintos: allá una pregunta, acá una postura. Nombrar la fila de la tabla
 * por su tipo produce el error que se cazó en pruebas —«acá se escribe: postura» en la etapa donde
 * una postura se rechaza—. Así que el vocabulario de pantalla se construye sobre la combinación
 * tipo × modo × relación, una sola vez, y lo usan el servidor (para explicar el rechazo) y la
 * interfaz (para dibujar el formulario). Dos redacciones distintas de lo mismo acaban discrepando.
 */
export type ClaveAporte =
  | 'pregunta'
  | 'postura'
  | 'responde'
  | 'sostiene'
  | 'razon'
  | 'evidencia'
  | 'supuesto'
  | 'riesgo'
  | 'alternativa';

export interface AporteEnPalabras {
  /** Cómo se ofrece en el formulario: «Una pregunta», «Una postura»… */
  readonly nombre: string;
  /** Para qué sirve, en una frase. Va debajo del control. */
  readonly ayuda: string;
  readonly tipo: TipoAporte;
}

export const APORTE_EN_PALABRAS: Readonly<Record<ClaveAporte, AporteEnPalabras>> = {
  pregunta: {
    nombre: 'Una pregunta',
    ayuda: 'Algo que no está claro y hace falta entender antes de opinar.',
    tipo: 'posicion',
  },
  postura: {
    nombre: 'Una postura',
    ayuda: 'Cómo ves el problema. Todavía no una solución.',
    tipo: 'posicion',
  },
  responde: {
    nombre: 'Una respuesta a una pregunta',
    ayuda: 'Contestá una pregunta concreta de las que ya están.',
    tipo: 'razon',
  },
  sostiene: {
    nombre: 'Una razón que sostiene una postura',
    ayuda: 'Por qué esa postura se sostiene.',
    tipo: 'razon',
  },
  razon: {
    nombre: 'Una razón',
    ayuda: 'Por qué se sostiene lo que se dijo, o la respuesta a una pregunta abierta.',
    tipo: 'razon',
  },
  evidencia: {
    nombre: 'Un dato que respalda una razón',
    ayuda: 'Un hecho comprobable. Va pegado a la razón que respalda, no a la conclusión.',
    tipo: 'evidencia',
  },
  supuesto: {
    nombre: 'Un supuesto',
    ayuda: 'Algo que se está dando por cierto sin haberlo dicho.',
    tipo: 'supuesto',
  },
  riesgo: {
    nombre: 'Un riesgo de una salida',
    ayuda: 'Qué puede salir mal, qué tan grave sería y cómo se reduciría.',
    tipo: 'riesgo',
  },
  alternativa: {
    nombre: 'Una salida propuesta',
    ayuda: 'Qué se hace, concretamente, para resolver el problema.',
    tipo: 'alternativa',
  },
};

/** La fila de la tabla de una etapa, resuelta a las opciones concretas que se le ofrecen a alguien. */
export function clavesDeAporte(reglas: {
  readonly tiposQueSeAdmitenAhora: readonly TipoAporte[];
  readonly modosQueSeAdmitenAhora: readonly ModoPosicion[];
  readonly relacionesQueSeAdmitenAhora: readonly RelacionRazon[];
}): readonly ClaveAporte[] {
  const claves: ClaveAporte[] = [];
  for (const tipo of reglas.tiposQueSeAdmitenAhora) {
    if (tipo === 'posicion') {
      for (const modo of reglas.modosQueSeAdmitenAhora) {
        claves.push(modo === 'pregunta_aclaratoria' ? 'pregunta' : 'postura');
      }
      continue;
    }
    if (tipo === 'razon') {
      // Con las dos relaciones abiertas se ofrece una sola opción: obligar a elegir entre «responde»
      // y «sostiene» cuando las dos valen es hacerle resolver a la persona una ambigüedad nuestra.
      if (reglas.relacionesQueSeAdmitenAhora.length === 1) {
        claves.push(reglas.relacionesQueSeAdmitenAhora[0] === 'responde' ? 'responde' : 'sostiene');
      } else if (reglas.relacionesQueSeAdmitenAhora.length > 1) {
        claves.push('sostiene');
        claves.push('responde');
      }
      continue;
    }
    claves.push(tipo);
  }
  return claves;
}

/**
 * Lo que la pantalla tiene que decir sobre la autoría mientras Perspectivas siga abierta.
 *
 * Está aquí y no en la web porque **es una obligación de ADR-0049**, no una redacción: la protección
 * es frente a las demás personas que participan, y **no** frente a quien administra el servidor. Un
 * cliente que dijera «anónimo» a secas estaría prometiendo algo que el sistema no da.
 *
 * La tercera frase se añadió al retirar la retención del historial descargable (ADR-0049,
 * corrección de 2026-08-22). El export volvió a ser completo porque retenerlo rompía la
 * verificabilidad del historial entero, y la consecuencia —que la autoría de esta etapa sí viaja
 * dentro del historial que cualquiera puede bajar— **se declara aquí, en la misma pantalla que
 * promete lo otro**. Es la doctrina que el proyecto ya aplica al secreto del voto: se dice de qué
 * protege y de qué no, en la cara, y no en un ADR que nadie va a leer.
 */
export const AVISO_AUTORIA_OCULTA =
  'Mientras esta etapa esté abierta, nadie ve quién escribió cada cosa: ni vos, ni quien cuida el ' +
  'procedimiento. Al cerrarla aparecen los nombres, incluido el tuyo. Esto te protege de las demás ' +
  'personas que participan, no de quien administra el servidor, que sí puede verlo en la máquina. ' +
  'Y quien descargue el historial completo desde «Verificar» sí puede ver quién escribió cada ' +
  'aporte: eso se dejó así para que el historial se pueda comprobar entero.';

export const AVISO_AUTORIA_VISIBLE =
  'Esta etapa ya cerró, así que cada aporte se muestra con quien lo escribió. Lo que se escribió ' +
  'antes no cambia: se le suma el nombre.';

/**
 * Tercer caso, y el que se olvida: la etapa ya cerró pero **quien mira no puede leer la autoría**
 * porque no entró, o porque este asunto lo lleva otro grupo.
 *
 * Sin esta frase la pantalla diría «ya se ve quién escribió cada cosa» y a continuación no mostraría
 * ni un nombre, que es la clase de contradicción que hace desconfiar de todo lo demás.
 */
export const AVISO_AUTORIA_SOLO_DEL_GRUPO =
  'Esta etapa ya cerró y cada aporte tiene nombre, pero los nombres los ve el grupo que lleva este ' +
  'asunto. Lo que estás leyendo es el contenido, que es público.';

const textoAporte = z
  .string()
  .min(
    MIN_CONTRIBUTION_LENGTH,
    'Contá algo más: con menos de veinte caracteres es una reacción, no un aporte.',
  )
  .max(4000, 'Quedó muy largo para leerlo en un teléfono. Partilo en dos aportes.');

const listaDeAportes = z
  .array(opaqueId)
  .min(1, 'Elegí al menos un aporte al que esto se refiere.')
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, 'Un aporte sólo se referencia una vez.');

/** Abrir una deliberación es un acto de procedimiento, con responsable y con plazo visible. */
export const abrirDeliberacion = z
  .object({
    requestId,
    problemaId: opaqueId,
    /** Cuánto dura la primera ventana. Se muestra siempre: un plazo que no se ve no es un plazo. */
    duracionHoras: z.number().int().min(1).max(720),
  })
  .strict();
export type AbrirDeliberacion = z.infer<typeof abrirDeliberacion>;

const aporteBase = z.object({
  requestId,
  /** Corregir es añadir: el aporte original permanece con su fecha y su autoría. */
  corrigeA: opaqueId.optional(),
});

/**
 * Un aporte, con **su arista obligatoria**. No hay una variante suelta: un aporte que no sabe a qué
 * responde no entra, y eso se decide aquí y otra vez en el motor.
 */
export const aportar = z.discriminatedUnion('tipo', [
  aporteBase
    .extend({ tipo: z.literal('posicion'), modo: modoPosicion, texto: textoAporte })
    .strict(),
  aporteBase
    .extend({
      tipo: z.literal('razon'),
      relacion: relacionRazon,
      posicionId: opaqueId,
      texto: textoAporte,
    })
    .strict(),
  aporteBase
    .extend({
      tipo: z.literal('evidencia'),
      sostieneRazonId: opaqueId,
      texto: textoAporte,
      fuente: z.string().min(1).max(140).optional(),
    })
    .strict(),
  aporteBase
    .extend({ tipo: z.literal('supuesto'), aplicaA: listaDeAportes, texto: textoAporte })
    .strict(),
  aporteBase
    .extend({
      tipo: z.literal('riesgo'),
      salidaId: opaqueId,
      gravedad: gravedadRiesgo,
      impacto: textoAporte,
      mitigacion: textoAporte,
    })
    .strict(),
  aporteBase
    .extend({
      tipo: z.literal('alternativa'),
      problemaId: opaqueId,
      saleDe: listaDeAportes,
      texto: textoAporte,
    })
    .strict(),
]);
export type Aportar = z.infer<typeof aportar>;

/** Avanzar de etapa cierra una ventana de escritura para siempre. Por eso no lleva nada más. */
export const avanzarEtapa = z.object({ requestId }).strict();
export type AvanzarEtapa = z.infer<typeof avanzarEtapa>;

/** Una arista del grafo, ya dicha en palabras: «Sostiene», «Responde a», «Riesgo de». */
export const vinculoAporte = z.object({ aporteId: opaqueId, comoSeRelaciona: z.string() }).strict();
export type VinculoAporte = z.infer<typeof vinculoAporte>;

/**
 * Un aporte tal como sale del servidor.
 *
 * `autorId` y `esMio` **faltan** mientras la etapa oculte la autoría, y faltan de verdad: no van
 * vacíos ni con un valor de relleno. Que falten los dos no es simetría decorativa —si `esMio`
 * viajara, quien mirara dos respuestas distintas sabría de quién es cada aporte por diferencia, que
 * es exactamente la fuga que la regla de etapa existe para cerrar (ADR-0049).
 */
export const aporteDeliberacion = z
  .object({
    id: opaqueId,
    tipo: tipoAporte,
    /** En qué ventana se escribió. La etapa vigente puede ser otra. */
    etapa: etapaDeliberacion,
    etapaEnPalabras: z.string(),
    /** Cómo se llama este aporte en pantalla: «Pregunta», «Postura», «Riesgo»… */
    comoSeLlama: z.string(),
    /**
     * Sólo en una `posicion`: si preguntó o si afirmó.
     *
     * Hace falta para que el formulario no ofrezca lo que el motor va a rechazar: una razón que
     * dice «sostiene» va sobre una afirmación y una que dice «responde» va sobre una pregunta, y
     * las dos son `posicion`. El motor **ya comprueba el modo del destino** —lo hacía sólo con el
     * tipo, y ese hueco está cerrado—, así que esto ya no sostiene la regla: la anticipa, que es lo
     * que le toca a una interfaz.
     */
    modo: modoPosicion.optional(),
    texto: z.string(),
    fuente: z.string().optional(),
    gravedad: gravedadRiesgo.optional(),
    gravedadEnPalabras: z.string().optional(),
    mitigacion: z.string().optional(),
    /** Qué sostiene, a qué responde, de qué es riesgo. Es el grafo, dicho en palabras. */
    responde: z.array(vinculoAporte),
    /** Si corrige a otro aporte. El corregido **sigue** en la lista, con su fecha. */
    corrigeA: opaqueId.optional(),
    /** `false` si alguien lo corrigió después. No desaparece: deja de ser la punta. */
    vigente: z.boolean(),
    /**
     * Cuándo se escribió. **Falta mientras la autoría esté oculta**, y falta por la misma razón que
     * falta el autor.
     *
     * Un instante al milisegundo junto a un aporte sin nombre no es un dato de presentación: es el
     * canal lateral clásico para desanonimizar. Basta con saber por otra vía —una conversación, un
     * «ya escribí», el momento en que alguien se conectó— a qué hora escribió una persona para
     * atribuirle el aporte, sin rozar la acción denegada. La regla queda dicha en una frase: mientras
     * no se pueda saber **quién**, tampoco se publica **cuándo**.
     */
    cuando: instantMs.optional(),
    autorId: opaqueId.optional(),
    esMio: z.boolean().optional(),
  })
  .strict();
export type AporteDeliberacion = z.infer<typeof aporteDeliberacion>;

export const deliberacionResumen = z.object({
  id: opaqueId,
  problemaId: opaqueId,
  problemaTitulo: z.string(),
  circuloId: opaqueId,
  etapa: etapaDeliberacion,
  etapaEnPalabras: z.string(),
  queSeHaceEnEstaEtapa: z.string(),
  abreEn: instantMs,
  cierraEn: instantMs,
  cuantosAportes: z.number().int().nonnegative(),
  /** `true` cuando cada aporte ya se muestra con quien lo escribió. */
  autoriaVisible: z.boolean(),
});
export type DeliberacionResumen = z.infer<typeof deliberacionResumen>;

export const deliberacionDetalle = deliberacionResumen.extend({
  /** La verdad sobre la autoría, en castellano llano. Va siempre, oculta o visible. */
  avisoDeAutoria: z.string(),
  aportes: z.array(aporteDeliberacion),
  /** Qué se puede escribir ahora mismo, dicho en palabras y no con identificadores. */
  queSePuedeEscribirAhora: z.string(),
  /**
   * La fila de la tabla del motor para esta etapa, tal cual.
   *
   * Va entera —tipos, modos y relaciones— porque si no la interfaz tendría que **volver a derivar**
   * qué cabe en cada etapa, y ese es el momento exacto en que aparecen dos tablas que se
   * contradicen: la pantalla ofrecería un control que la orden rechaza, o escondería uno que sí
   * cabía. Acá el formulario se dibuja con lo que dice el motor y con nada más.
   */
  tiposQueSeAdmitenAhora: z.array(tipoAporte),
  modosQueSeAdmitenAhora: z.array(modoPosicion),
  relacionesQueSeAdmitenAhora: z.array(relacionRazon),
  /** `true` en Enmiendas: allí una salida corrige a otra y el formulario tiene que exigirlo. */
  laSalidaDebeCorregirAOtra: z.boolean(),
  puedoAportar: z.boolean(),
  motivoNoPuedoAportar: z.string().optional(),
  /** Lo decide el servidor con la matriz del motor. La ruta vuelve a comprobarlo igual. */
  puedoAvanzarEtapa: z.boolean(),
  etapaSiguiente: etapaDeliberacion.optional(),
  etapaSiguienteEnPalabras: z.string().optional(),
});
export type DeliberacionDetalle = z.infer<typeof deliberacionDetalle>;

/**
 * Rechazos propios de la deliberación, dichos para quien los lee.
 *
 * Viven aquí —y no en `errors.ts`— junto al resto del vocabulario de esta pantalla; `mensajeDe` los
 * recibe como respaldo desde la capa HTTP, que es la que sabe en qué etapa está la deliberación y
 * puede decir además qué sí cabe ahora.
 */
export const MENSAJES_DELIBERACION: Readonly<Record<string, string>> = {
  CONTRIBUTION_KIND_NOT_ALLOWED: 'Eso no se escribe en la etapa en la que va la conversación.',
  POSITION_MODE_NOT_ALLOWED: 'Eso no se escribe en la etapa en la que va la conversación.',
  REASON_RELATION_NOT_ALLOWED: 'Eso no se escribe en la etapa en la que va la conversación.',
  AMENDMENT_MUST_SUPERSEDE:
    'En Enmiendas una salida corrige a otra: elegí cuál estás corrigiendo. Si es una salida nueva, ' +
    'ya pasó su turno.',
  WRITE_WINDOW_CLOSED:
    'El plazo de esta etapa ya venció. Lo que se escribe tarde no se guarda para después: una ' +
    'perspectiva escrita sin ver las demás no puede reaparecer cuando ya se leyeron todas.',
  WRITE_WINDOW_NOT_OPEN: 'Esta etapa todavía no abrió. Arriba dice a qué hora empieza.',
  MAX_CONTRIBUTIONS_PER_AUTHOR_PER_STAGE_REACHED:
    'Ya escribiste todo lo que cabe por persona en esta etapa. En la siguiente empezás de cero.',
  UNKNOWN_CONTRIBUTION_REFERENCE: 'Eso a lo que querés responder ya no está en esta conversación.',
  WRONG_REFERENCE_KIND: 'Eso a lo que querés responder no es de la clase que hace falta acá.',
  WRONG_REFERENCE_MODE:
    'Una razón que sostiene va sobre una postura, y una que responde va sobre una pregunta. Lo que ' +
    'elegiste es de la otra clase.',
  SUPERSEDES_ANOTHER_AUTHOR:
    'Sólo podés corregir lo que escribiste vos. Lo de otra persona no se corrige: se le responde, ' +
    'y las dos cosas quedan.',
  FORWARD_REFERENCE: 'No se puede responder a algo que se escribió después.',
  ASSUMPTION_WITHOUT_TARGET: 'Decí a qué aporte se le aplica ese supuesto.',
  ALTERNATIVE_WITHOUT_SOURCE: 'Decí de qué posturas sale esa salida.',
  DELIBERATION_NOT_OPEN: 'No encontramos esa conversación.',
  DELIBERATION_ALREADY_OPEN: 'Ese problema ya tiene una conversación abierta.',
  UNAUTHORIZED_STAGE_STILL_OPEN:
    'Todavía no se puede saber quién escribió cada cosa. Aparece cuando esta etapa cierre, y no ' +
    'hay ningún papel en el grupo que lo adelante.',
  UNAUTHORIZED_STAGE_UNKNOWN: 'No encontramos esa conversación.',
  UNKNOWN_CONTRIBUTION: 'Ese aporte no está en esta conversación.',
};

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Integridad
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const comprobacion = z.object({
  /** Identificador estable de la comprobación, para el registro. */
  id: z.string(),
  /** Qué se comprobó, dicho para alguien que no sabe qué es una huella. */
  queSeComprobo: z.string(),
  /** `true` = verde. */
  bien: z.boolean(),
  /** Qué significa que esté bien o mal. Siempre presente: un semáforo sin explicación no informa. */
  queSignifica: z.string(),
  detalle: z.string().optional(),
});
export type Comprobacion = z.infer<typeof comprobacion>;

export const informeIntegridad = z.object({
  /** `true` sólo si TODAS las comprobaciones pasaron. */
  todoBien: z.boolean(),
  comprobadoEn: instantMs,
  /** Desde cuándo hay historial. */
  historialDesde: instantMs.optional(),
  hechosRevisados: z.number().int().nonnegative(),
  comprobaciones: z.array(comprobacion),
  /** Qué parte pública comprobar por cuenta propia y qué parte privada sigue siendo auditoría local. */
  comoComprobarloVosMismo: z.object({
    explicacion: z.string(),
    comando: z.string(),
    urlDeDescarga: z.string(),
  }),
});
export type InformeIntegridad = z.infer<typeof informeIntegridad>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Portada
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const portada = z.object({
  /**
   * `true` cuando no ha pasado nada todavía. La pantalla de estado vacío es la más importante y la
   * que todos olvidan: es lo único que ve la comunidad el primer día.
   */
  primerDia: z.boolean(),
  problemas: z.number().int().nonnegative(),
  propuestas: z.number().int().nonnegative(),
  iniciativasActivas: z.number().int().nonnegative(),
  decisionesAbiertas: z.array(decisionResumen),
  ultimasCerradas: z.array(decisionResumen),
  /** **Una sola** cosa pendiente. Si hay más, se elige la más urgente. */
  loQueTeToca: z
    .object({ que: z.string(), enlace: z.string(), cierraEn: instantMs.optional() })
    .optional(),
});
export type Portada = z.infer<typeof portada>;

export { apiError };
export type { ApiError } from './errors.js';
