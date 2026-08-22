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
