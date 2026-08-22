/**
 * Forma de los errores de la API y su traducción a palabras.
 *
 * WCAG 2.2 AA exige «errores en palabras, no en códigos» y PRODUCT lo repite en la tabla de
 * pantallas: «se bloquea con explicación, no con un código». Las dos cosas conviven: el `codigo` es
 * para el registro y para la lógica del cliente; `mensaje` es lo que lee una persona, y sale de
 * aquí para que no haya dos redacciones del mismo rechazo.
 */

import { z } from 'zod';

export const apiError = z.object({
  /** Código estable. Nunca se muestra solo. */
  codigo: z.string(),
  /** Frase en español, dirigida a quien la lee, sin jerga. */
  mensaje: z.string(),
  /** Qué campo del formulario está mal, si aplica. */
  campo: z.string().optional(),
  /** Qué se puede hacer al respecto. Un error sin salida es un callejón. */
  queHacer: z.string().optional(),
});

export type ApiError = z.infer<typeof apiError>;

/**
 * Traducción de los códigos del dominio a frases.
 *
 * Está aquí, en `contracts`, y no en la web: si viviera en la web, un cliente distinto —el
 * verificador independiente, un guion de alguien— mostraría el código crudo, y el mismo rechazo
 * tendría dos caras.
 */
export const MENSAJES: Readonly<Record<string, string>> = {
  // ── Autorización ────────────────────────────────────────────────────────────────────────────
  UNAUTHORIZED_NOT_AUTHENTICATED:
    'Para hacer esto hay que entrar con el correo institucional. Tu borrador se conserva.',
  UNAUTHORIZED_ROLE_NOT_GRANTED: 'Tu papel en el Instituto no incluye esta acción.',
  UNAUTHORIZED_NOT_THE_OWNER:
    'Esto lo escribió otra persona y sólo ella puede cambiarlo. Podés responderle o proponer una ' +
    'enmienda, que queda como texto tuyo.',
  UNAUTHORIZED_NOT_THE_SUBJECT:
    'Nadie puede actuar en nombre de otra persona. Este acto quedaría a nombre de alguien que no sos vos.',
  UNAUTHORIZED_NOT_A_READER:
    'Ese material restringido sólo puede abrirlo quien lo aportó o quien debe revisar la entrega.',
  UNAUTHORIZED_NOT_IN_CIRCLE: 'Este asunto lo lleva otro grupo, y hay que ser parte de él.',
  UNAUTHORIZED_OWNER_UNKNOWN: 'No encontramos eso que querés cambiar.',

  // ── Sesión y correo ─────────────────────────────────────────────────────────────────────────
  ENLACE_INVALIDO: 'Ese enlace no sirve. Pedí uno nuevo desde la pantalla de entrar.',
  ENLACE_VENCIDO: 'Ese enlace ya venció. Los enlaces duran 15 minutos; pedí uno nuevo.',
  ENLACE_YA_USADO:
    'Ese enlace ya se usó una vez y no se puede volver a usar. Pedí uno nuevo si necesitás entrar otra vez.',
  CORREO_NO_INSTITUCIONAL:
    'Sólo entran los correos que terminan en @udea.edu.co. Es lo único que verificamos: matrícula activa.',
  DEMASIADOS_INTENTOS: 'Pediste muchos enlaces seguidos. Esperá un momento y volvé a intentar.',
  ERASURE_REAUTHENTICATION_REQUIRED:
    'Para pedir una supresión irreversible tenés que volver a entrar. La sesión reciente confirma que sos vos.',
  ERASURE_ALREADY_REQUESTED:
    'Ya existe una solicitud de supresión a tu nombre. Conservá el radicado; no hace falta crear otra.',
  ERASURE_AUTHORIZATION_UNAVAILABLE:
    'No existe una solicitud propia válida que autorice esa supresión. No se borró ningún dato.',

  // ── Textos ──────────────────────────────────────────────────────────────────────────────────
  INVALID_TEXT: 'Falta texto o hay demasiado. Fijate en la ayuda que está debajo del campo.',

  // ── Papeletas ───────────────────────────────────────────────────────────────────────────────
  BALLOT_INELIGIBLE_VOTER:
    'No estabas en la lista de quienes podían decidir aquí, que se cerró al abrir la votación.',
  BALLOT_OUT_OF_WINDOW: 'La votación ya cerró. No hay período de gracia: cierra cuando dice.',
  BALLOT_STALE_PROPOSAL_VERSION:
    'El texto cambió después de que emitiste tu respuesta. Hay que volver a responder sobre el texto nuevo: ' +
    'estar de acuerdo con un texto es estar de acuerdo con ese texto.',
  BALLOT_OBJECTION_REQUIRED: 'Para objetar hay que decir qué se daña y por qué.',
  BALLOT_OBJECTION_ARGUMENT_TOO_SHORT:
    'La objeción necesita más argumento: bloquear a la comunidad tiene que costar, como mínimo, explicarse.',
  BALLOT_OBJECTION_AIM_MISSING:
    'Una objeción señala un daño a lo que el grupo se propuso. Sin eso es una preferencia, que se ' +
    'registra como reserva.',
  BALLOT_PAYLOAD_KIND_NOT_ACCEPTED:
    'Esa forma de responder no es la que corresponde a esta decisión.',

  // ── Estado ──────────────────────────────────────────────────────────────────────────────────
  ILLEGAL_TRANSITION: 'Esto no se puede hacer en el momento en el que está el asunto.',
  NOT_CLOSED: 'Todavía no hay resultado: la votación sigue abierta.',
  PROBLEM_NOT_OPEN: 'No encontramos ese problema.',
  ALREADY_ME_TOO: 'Ya habías dicho que te pasa lo mismo. No se cuenta dos veces.',
  NOT_THE_OWNER: 'Esto lo escribió otra persona y sólo ella puede cambiarlo.',
  NON_CONSECUTIVE_VERSION: 'Alguien enmendó el texto mientras escribías. Mirá la versión nueva.',
  VERSION_UNCHANGED: 'El texto quedó igual que antes, así que no hay nada nuevo que guardar.',
  NO_RATIONALE:
    'Hay que decir qué cambia y por qué. Sin eso, «versión 2» es un número sin información.',
  IDEMPOTENCY_KEY_REUSED:
    'Esa clave ya quedó ligada a otra acción. No se escribió nada nuevo ni se cambió el historial.',

  // ── Ratificación y ejecución ────────────────────────────────────────────────────────────────
  CHALLENGE_WINDOW_OPEN:
    'Todavía está abierto el tiempo para impugnar esta decisión. La iniciativa no puede empezar hasta que venza.',
  OUTCOME_NOT_RATIFIABLE:
    'Esta decisión no tiene un resultado que pueda ratificarse para empezar la iniciativa.',
  OUTCOME_NOT_REJECTABLE: 'Esta decisión no está en un estado que permita registrar ese rechazo.',
  RESULT_ALREADY_COMPUTED:
    'El resultado ya fue publicado y no puede calcularse ni publicarse una segunda vez.',
  RATIFICATION_REQUIRES_MEMBER:
    'La ratificación debe hacerla una persona integrante vigente del grupo que tomó la decisión.',
  INITIATIVE_ALREADY_ACTIVATED: 'Esta iniciativa ya está activa.',
  INITIATIVE_ALREADY_CREATED: 'Esta iniciativa ya fue creada y no puede crearse de nuevo.',
  INITIATIVE_GENESIS_REQUIRED:
    'Falta el origen verificable de esta iniciativa; no se puede continuar con un historial incompleto.',
  INITIATIVE_NOT_ACTIVE:
    'Esta iniciativa todavía no está activa. Primero debe vencer la impugnación y ratificarse la decisión.',
  INITIATIVE_REQUIRES_APPROVED:
    'Sólo una decisión aprobada puede convertirse en una iniciativa activa.',
  INITIATIVE_RESPONSIBLE_ONLY:
    'Sólo la persona responsable inicial puede organizar los primeros hitos y ofrecer tareas.',
  INITIATIVE_SYSTEM_ONLY:
    'La creación y activación de una iniciativa son actos automáticos ligados a la decisión; una persona no puede forzarlos.',
  NON_CONSECUTIVE_INITIATIVE_EVENT:
    'El historial de esta iniciativa tiene un salto o un evento fuera de orden. No se escribió nada nuevo.',
  INITIATIVE_MILESTONE_NOT_FOUND: 'No encontramos ese hito dentro de esta iniciativa.',
  INITIATIVE_RESPONSIBLE_REQUIRED:
    'Sólo la persona responsable inicial puede organizar los primeros hitos y ofrecer tareas.',
  UNKNOWN_MILESTONE: 'No encontramos ese hito dentro de esta iniciativa.',
  DUPLICATE_MILESTONE: 'Ese hito ya existe en esta iniciativa.',
  MILESTONE_DUE_AFTER_REVIEW:
    'La fecha del hito no puede pasar la revisión que la comunidad aprobó para esta iniciativa.',
  MILESTONE_AFTER_REVIEW:
    'La fecha del hito no puede pasar la revisión que la comunidad aprobó para esta iniciativa.',
  DUPLICATE_TASK: 'Esa tarea ya existe en esta iniciativa.',
  UNKNOWN_TASK: 'No encontramos esa tarea dentro de esta iniciativa.',
  TASK_EFFORT_INVALID:
    'El esfuerzo estimado debe ser un número entero entre un minuto y siete días.',
  TASK_DUE_AFTER_MILESTONE: 'La fecha de la tarea no puede pasar la fecha límite de su hito.',
  TASK_DEPENDENCY_NOT_FOUND:
    'Una de las tareas de las que depende esta no existe en esta iniciativa.',
  UNKNOWN_TASK_DEPENDENCY:
    'Una de las tareas de las que depende esta no existe en esta iniciativa.',
  TASK_DEPENDENCY_DUPLICATE: 'Una misma tarea no puede aparecer dos veces como dependencia.',
  TASK_DEPENDENCY_SELF: 'Una tarea no puede depender de sí misma.',
  TASK_SELF_DEPENDENCY: 'Una tarea no puede depender de sí misma.',
  TASK_DEPENDENCY_CYCLE: 'Estas dependencias formarían un ciclo y nadie podría empezar.',
  TOO_MANY_TASK_DEPENDENCIES:
    'La tarea tiene demasiadas dependencias. Dividila en una parte más pequeña y verificable.',
  STALE_TASK_OFFER: 'Esa oferta ya fue reemplazada. Revisá la oferta vigente antes de responder.',
  STALE_TASK_REVISION:
    'La tarea cambió mientras respondías. Revisá su estado vigente antes de volver a intentarlo.',
  TASK_OFFER_NOT_PENDING: 'Esa oferta ya recibió una respuesta y no puede volver a responderse.',
  TASK_OFFER_ALREADY_ANSWERED:
    'Esa oferta ya recibió una respuesta y no puede volver a responderse.',
  TASK_ACTOR_MISMATCH: 'Esta oferta está dirigida a otra persona y sólo ella puede responderla.',
  INVALID_TASK_RESPONSE_REASON:
    'Elegí uno de los motivos generales. Si no querés contarlo, podés elegir “Prefiero no publicar el motivo”.',
  TASK_REASSIGNMENT_NOT_ALLOWED:
    'Esta tarea no está asignada de una forma que permita pedir reasignación.',
  TASK_REOFFER_NOT_ALLOWED:
    'Sólo una tarea rechazada o con reasignación solicitada puede ofrecerse de nuevo.',
  TASK_REOFFER_SAME_RECIPIENT:
    'La nueva oferta debe dirigirse a otra persona; ofrecerla de nuevo a quien la rechazó no resuelve el bloqueo.',
  TASK_OFFER_ID_REUSED:
    'Esa identificación de oferta ya existe. No se escribió una oferta ambigua ni se reemplazó la anterior.',
  TASK_START_NOT_ALLOWED:
    'Esta tarea no está lista para empezar. Revisá si sigue aceptada y si sus dependencias ya terminaron.',
  TASK_DEPENDENCY_NOT_COMPLETED: 'Todavía falta terminar una tarea de la que depende este trabajo.',
  TASK_BLOCK_NOT_ALLOWED: 'Esta tarea no está en un estado que permita declarar un bloqueo.',
  TASK_HELP_NOT_ALLOWED: 'Esta tarea no está en un estado que permita pedir ayuda.',
  TASK_RESUME_NOT_ALLOWED: 'Esta tarea no tiene una pausa vigente que se pueda reanudar.',
  STALE_TASK_PAUSE:
    'La pausa cambió mientras actuabas. Revisá el estado vigente antes de volver a intentarlo.',
  TASK_EVIDENCE_NOT_ALLOWED:
    'Esta tarea no está recibiendo evidencia en este momento. Revisá su estado vigente.',
  INVALID_TASK_EVIDENCE_KIND_CODE: 'El tipo general de evidencia no es uno de los admitidos.',
  INVALID_TASK_EVIDENCE_SIZE_CLASS: 'La clase general de tamaño no es una de las admitidas.',
  INVALID_TASK_EVIDENCE_VISIBILITY: 'La visibilidad de la evidencia no es una de las admitidas.',
  TASK_DELIVERY_NOT_ALLOWED:
    'La tarea debe estar en curso, sin pausa vigente y con evidencia antes de entregarse.',
  TASK_DELIVERY_EVIDENCE_COUNT_INVALID:
    'La entrega debe referenciar al menos una evidencia válida.',
  TASK_DELIVERY_EVIDENCE_DUPLICATE: 'Una evidencia sólo puede aparecer una vez en la entrega.',
  UNKNOWN_TASK_EVIDENCE: 'Esa evidencia no pertenece a esta tarea.',
  STALE_TASK_DELIVERY:
    'La entrega cambió mientras actuabas. Revisá la entrega vigente antes de volver a intentarlo.',
  TASK_REVIEW_NOT_ALLOWED: 'Esta entrega ya fue revisada o todavía no está lista para revisión.',
  INVALID_TASK_BLOCK_CATEGORY: 'Elegí una de las causas generales de bloqueo.',
  INVALID_TASK_HELP_CATEGORY: 'Elegí uno de los tipos generales de ayuda.',
  INVALID_TASK_CHANGE_REASON: 'Elegí uno de los motivos generales para pedir cambios.',
  TASK_EVIDENCE_ID_REUSED:
    'Esa identificación de evidencia ya existe. No se escribió una referencia ambigua.',
  TASK_DELIVERY_ID_REUSED:
    'Esa identificación de entrega ya existe. No se escribió una entrega ambigua.',
  TASK_PAUSE_TIME_REVERSED:
    'El historial temporal de la pausa no es consistente. No se escribió ningún cambio.',

  // ── Capacidad privada ──────────────────────────────────────────────────────────────────────
  STALE_CAPACITY_REVISION:
    'Tu capacidad cambió mientras la estabas editando. Revisá el valor vigente antes de volver a guardar.',
  CAPACITY_SERVICE_UNAVAILABLE:
    'Tu capacidad privada no está disponible en este momento. No se mostró ni se guardó un valor sin protección.',
  PRIVATE_MATERIAL_UNAVAILABLE:
    'Ese material restringido no está disponible o no pudo comprobarse de forma segura.',
  TASK_CAPACITY_NOT_DECLARED:
    'No pudimos confirmar esta aceptación. Revisá tu capacidad propia antes de volver a intentarlo.',
  TASK_CAPACITY_CONFIRMATION_BLOCKED:
    'No pudimos confirmar esta aceptación. Revisá tu capacidad propia antes de volver a intentarlo.',
  TASK_CAPACITY_EXCEEDED:
    'No se pudo confirmar esta tarea con tu capacidad vigente. Revisá tu capacidad privada en Mis tareas.',
  TASK_CAPACITY_ADMISSION_REQUIRED:
    'No se pudo comprobar tu capacidad de forma segura. No se aceptó la tarea.',
  TASK_CAPACITY_ADMISSION_MISMATCH:
    'La comprobación de capacidad ya no corresponde a esta oferta. Revisá la tarea vigente.',
  TASK_ACCEPTANCE_CANDIDATE_REQUIRED:
    'No se pudo validar la oferta antes de revisar tu capacidad. No se aceptó la tarea.',

  // ── Genéricos ───────────────────────────────────────────────────────────────────────────────
  NO_ENCONTRADO: 'No encontramos eso.',
  DATOS_INVALIDOS: 'Faltan datos o alguno no tiene la forma esperada.',
  CONFLICTO: 'Alguien más escribió al mismo tiempo. Volvé a intentarlo.',
  ERROR_INTERNO:
    'Algo se rompió de nuestro lado. No se perdió nada de lo que ya estaba guardado: el historial no se toca.',
};

/** Frase para un código. Si el código es desconocido, se devuelve una frase honesta, no el código. */
export function mensajeDe(codigo: string, respaldo?: string): string {
  return (
    MENSAJES[codigo] ??
    respaldo ??
    'No pudimos completar esa acción. Si vuelve a pasar, contalo en el historial del grupo.'
  );
}
