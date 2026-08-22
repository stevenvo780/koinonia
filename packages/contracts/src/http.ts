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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Iniciativas
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const estadoIniciativa = z.enum(['por-empezar']);
export type EstadoIniciativa = z.infer<typeof estadoIniciativa>;

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
});
export type IniciativaResumen = z.infer<typeof iniciativaResumen>;

export const iniciativaDetalle = iniciativaResumen;
export type IniciativaDetalle = z.infer<typeof iniciativaDetalle>;

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
  /** Qué hacer para comprobarlo por tu cuenta, sin confiar en esta página. */
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
