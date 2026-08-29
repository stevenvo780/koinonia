/**
 * Autorización **del dominio** (no de la ruta).
 *
 * ═══ Por qué esto no vive en un middleware ═══
 *
 * El fallo más repetido del software de gobernanza es poner la comprobación en el borde HTTP: un
 * `preHandler` mira el rol, la ruta queda protegida, y seis meses después alguien añade
 * `PATCH /propuestas/:id` sin acordarse del `preHandler`. La regla no estaba en el sistema: estaba
 * en una ruta. Aquí la regla vive donde vive el hecho: **ninguna orden del dominio construye un
 * evento sin haber llamado antes a `authorize`**, y `authorize` es una función pura sobre
 * `(actor, acción, recurso)`. Saltarse la interfaz no sirve de nada porque no hay ninguna otra
 * puerta: la orden es la puerta.
 *
 * ═══ Autorización horizontal ═══
 *
 * La vertical («¿tenés el rol?») la hace todo el mundo. La horizontal («¿es *tuyo* el recurso?») se
 * olvida siempre, y es la que rompe un sistema entre iguales: 300 personas con el MISMO rol de
 * miembro, y ninguna puede tocar lo de otra. Por eso `ResourceRef.owner` **no es opcional en la
 * práctica**: toda acción marcada como `ownerOnly` exige que el recurso declare su autor y que
 * coincida con el actor. Si el recurso llega sin autor, se deniega —fallar cerrado—, en lugar de
 * dejar pasar por ausencia de dato, que es exactamente cómo se cuelan estos fallos.
 *
 * ═══ Autorización con alcance de ETAPA ═══
 *
 * Hay un dato que no está prohibido ni permitido en abstracto, sino **hasta cierto momento**: quién
 * escribió cada perspectiva. ADR-0049 lo resuelve aquí y no con criptografía: `deliberation:read-
 * authorship` se deniega mientras la etapa vigente de la deliberación sea `perspectivas`, y se
 * concede en cuanto la etapa cambia. Es una fila más de la matriz, con la misma forma que las demás,
 * y **no depende del rol**: quien facilita tampoco lee la autoría antes de tiempo.
 *
 * Como toda regla de aquí, falla cerrado: si el recurso no declara etapa, se deniega. Un recurso sin
 * etapa declarada no es «una deliberación cualquiera», es un dato que falta.
 *
 * ═══ Qué NO decide este módulo ═══
 *
 * La elegibilidad para votar **no** es autorización: se decide contra el padrón congelado
 * (`electorate.ts`, INV-02) y no contra los roles vivos de nadie. Un miembro con rol vigente que no
 * está en el padrón de esa decisión no vota, y alguien que se retiró después de la congelación sí.
 * Mezclar las dos cosas sería reintroducir el padrón móvil por la puerta de atrás.
 */

import type { DeliberationStage } from './deliberation/types.js';
import { DomainError } from './errors.js';
import type { CircleId, MemberId } from './ids.js';

/**
 * Roles del §2 y del §7 de `docs/GOVERNANCE.md`.
 *
 * `tech-admin` está en la lista **para poder denegarle cosas**: el administrador técnico existe
 * porque alguien mantiene el servidor encendido, y la tabla del §7 dice con todas las letras lo que
 * no puede hacer. Un rol que sólo aparece cuando concede permisos es un rol sin límites.
 */
export type Role =
  /** Cualquiera. Lo público se lee sin cuenta. */
  | 'observer'
  /** Matrícula activa verificada. Delibera y decide en la Asamblea. */
  | 'member'
  /** Cuida el procedimiento: abre fases y ventanas. **Nunca califica objeciones** (§7). */
  | 'facilitator'
  /** Círculo de Garantías: anulación motivada, cierre manual, firmas. */
  | 'guarantees'
  /** Administrador técnico. Ver la tabla de «no puede» del §7. */
  | 'tech-admin';

export const ROLES: readonly Role[] = [
  'observer',
  'member',
  'facilitator',
  'guarantees',
  'tech-admin',
];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * Quién actúa. Sin datos personales: el dominio conoce identificadores opacos (R1).
 *
 * `memberId` ausente ⇒ nadie ha demostrado ser nadie. Es el observador anónimo, que sólo lee.
 */
export interface Actor {
  readonly memberId: MemberId | undefined;
  readonly roles: readonly Role[];
  /** Círculos a los que pertenece. Base de la autorización por dominio (§3). */
  readonly circles: readonly CircleId[];
}

/** El observador anónimo: sin identidad, sin círculos, sólo lectura de lo público. */
export const ANONYMOUS: Actor = { memberId: undefined, roles: ['observer'], circles: [] };

export type Action =
  | 'circle:members-read'
  | 'problem:read'
  | 'problem:create'
  | 'problem:me-too'
  | 'evidence:attach'
  | 'evidence:retract'
  | 'proposal:read'
  | 'proposal:create'
  | 'proposal:amend'
  | 'decision:read'
  | 'decision:open'
  | 'decision:cast-ballot'
  | 'decision:close'
  | 'decision:ratify'
  | 'deliberation:open'
  | 'deliberation:contribute'
  | 'deliberation:advance-stage'
  | 'deliberation:read-authorship'
  | 'meeting:read'
  | 'meeting:convene'
  | 'meeting:publish-minutes'
  | 'meeting:link-agreement'
  | 'constitution:read'
  | 'constitution:found'
  | 'constitution:propose-reform'
  | 'constitution:record-vote'
  | 'constitution:approve'
  | 'constitution:ratify'
  | 'initiative:plan'
  | 'task:offer'
  | 'task:reoffer'
  | 'task:accept'
  | 'task:reject'
  | 'task:request-reassignment'
  | 'task:start'
  | 'task:block'
  | 'task:request-help'
  | 'task:resume'
  | 'task:add-evidence'
  | 'task:deliver'
  | 'task:read-private-material'
  | 'task:request-changes'
  | 'task:accept-review'
  | 'ledger:read'
  | 'ledger:export';

export const ACTIONS: readonly Action[] = [
  'circle:members-read',
  'problem:read',
  'problem:create',
  'problem:me-too',
  'evidence:attach',
  'evidence:retract',
  'proposal:read',
  'proposal:create',
  'proposal:amend',
  'decision:read',
  'decision:open',
  'decision:cast-ballot',
  'decision:close',
  'decision:ratify',
  'deliberation:open',
  'deliberation:contribute',
  'deliberation:advance-stage',
  'deliberation:read-authorship',
  'meeting:read',
  'meeting:convene',
  'meeting:publish-minutes',
  'meeting:link-agreement',
  'constitution:read',
  'constitution:found',
  'constitution:propose-reform',
  'constitution:record-vote',
  'constitution:approve',
  'constitution:ratify',
  'initiative:plan',
  'task:offer',
  'task:reoffer',
  'task:accept',
  'task:reject',
  'task:request-reassignment',
  'task:start',
  'task:block',
  'task:request-help',
  'task:resume',
  'task:add-evidence',
  'task:deliver',
  'task:read-private-material',
  'task:request-changes',
  'task:accept-review',
  'ledger:read',
  'ledger:export',
];

export type ResourceKind =
  | 'circle'
  | 'problem'
  | 'evidence'
  | 'proposal'
  | 'decision'
  | 'deliberation'
  | 'meeting'
  | 'constitution'
  | 'initiative'
  | 'task'
  | 'ledger';

/**
 * El recurso sobre el que se actúa.
 *
 * `owner` es quien lo escribió; `subject` es la persona **a la que el acto se atribuye**. Son
 * distintos y hacen falta los dos: emitir una papeleta no tiene «autor» en el sentido de propiedad,
 * pero sí tiene un sujeto —el votante— y nadie puede votar por otro.
 */
export interface ResourceRef {
  readonly kind: ResourceKind;
  readonly owner?: MemberId | undefined;
  readonly subject?: MemberId | undefined;
  /** Identidades que pueden abrir un material privado; nunca se incluyen en errores. */
  readonly authorizedReaders?: readonly MemberId[] | undefined;
  readonly circleId?: CircleId | undefined;
  /**
   * Etapa **vigente** de la deliberación a la que pertenece el recurso.
   *
   * Sólo la miran las acciones con alcance de etapa. Se toma del estado plegado del agregado, nunca
   * de lo que diga quien llama: por eso el dominio ofrece `authorizeAuthorshipRead`, que la deriva
   * del historial y no admite que el llamante la invente.
   */
  readonly stage?: DeliberationStage | undefined;
}

export type DenialReason =
  /** No hay identidad: el acto exige una cuenta verificada. */
  | 'NOT_AUTHENTICATED'
  /** Ningún rol del actor concede la acción. */
  | 'ROLE_NOT_GRANTED'
  /** El recurso es de otra persona (autorización HORIZONTAL). */
  | 'NOT_THE_OWNER'
  /** El acto se atribuiría a otra persona (autorización HORIZONTAL). */
  | 'NOT_THE_SUBJECT'
  /** La lista de lectores autorizados falta: se falla cerrado. */
  | 'READERS_UNKNOWN'
  /** La identidad existe, pero no es una de las lectoras autorizadas. */
  | 'NOT_A_READER'
  /** El actor no pertenece al círculo competente (§3, subsidiariedad). */
  | 'NOT_IN_CIRCLE'
  /** El recurso llegó sin autor declarado y la acción lo exige: se falla cerrado. */
  | 'OWNER_UNKNOWN'
  /** La etapa que oculta el dato sigue siendo la vigente. No depende del rol (ADR-0049). */
  | 'STAGE_STILL_OPEN'
  /** El recurso no declara etapa vigente y la acción se decide por etapa: se falla cerrado. */
  | 'STAGE_UNKNOWN';

/** Denegación de autorización. Lleva el código estable y ni un dato personal. */
export class UnauthorizedError extends DomainError {
  readonly reason: DenialReason;
  readonly action: Action;

  constructor(reason: DenialReason, action: Action, detail: string) {
    super(`UNAUTHORIZED_${reason}`, `no autorizado para ${action} (${reason}): ${detail}`);
    this.name = 'UnauthorizedError';
    this.reason = reason;
    this.action = action;
  }
}

interface Rule {
  /** Roles que pueden intentar la acción. Vacío ⇒ nadie. */
  readonly roles: readonly Role[];
  /** ¿Exige identidad verificada? */
  readonly authenticated: boolean;
  /** ¿Exige ser el autor del recurso? Autorización horizontal. */
  readonly ownerOnly: boolean;
  /** ¿Exige que el acto se atribuya al propio actor? Autorización horizontal. */
  readonly subjectOnly: boolean;
  /** ¿Exige aparecer en la lista cerrada de lectores del material privado? */
  readonly readerOnly: boolean;
  /** ¿Exige pertenecer al círculo competente? */
  readonly circleOnly: boolean;
  /**
   * Etapa cuya vigencia **deniega** la acción; `undefined` ⇒ la acción no depende de ninguna etapa.
   *
   * Es lo que da alcance temporal a un permiso sin inventar un mecanismo aparte: el dato existe
   * desde el primer momento y lo que cambia con el tiempo es quién puede leerlo.
   */
  readonly deniedDuringStage: DeliberationStage | undefined;
}

const OPEN: Rule = {
  roles: ROLES,
  authenticated: false,
  ownerOnly: false,
  subjectOnly: false,
  readerOnly: false,
  circleOnly: false,
  deniedDuringStage: undefined,
};

const MEMBER: Rule = {
  roles: ['member', 'facilitator', 'guarantees'],
  authenticated: true,
  ownerOnly: false,
  subjectOnly: false,
  readerOnly: false,
  circleOnly: false,
  deniedDuringStage: undefined,
};

const CIRCLE_MEMBER: Rule = { ...MEMBER, circleOnly: true };
const OWNER_IN_CIRCLE: Rule = { ...CIRCLE_MEMBER, ownerOnly: true };
const SUBJECT_IN_CIRCLE: Rule = { ...CIRCLE_MEMBER, subjectOnly: true };
const PRIVATE_READER_IN_CIRCLE: Rule = { ...CIRCLE_MEMBER, readerOnly: true };

/**
 * La matriz. Es la tabla del §4 de `docs/GOVERNANCE.md` en forma ejecutable.
 *
 * Nótese que `tech-admin` **no aparece en ninguna regla de escritura de gobierno**. No es un olvido:
 * es la tabla del §7 —«no puede abrir, cerrar, prorrogar ni anular decisiones», «no puede crear,
 * eliminar ni modificar miembros del padrón»— escrita donde se aplica. El administrador puede
 * desplegar y hacer copias; no puede gobernar.
 */
const RULES: Readonly<Record<Action, Rule>> = {
  'problem:read': OPEN,
  'proposal:read': OPEN,
  'decision:read': OPEN,
  'ledger:read': OPEN,
  'ledger:export': OPEN,

  // El selector de destinatarios no expone un directorio mundial: sólo miembros autenticados del
  // círculo competente pueden pedir la lista de ese círculo.
  'circle:members-read': CIRCLE_MEMBER,

  'problem:create': MEMBER,
  'problem:me-too': { ...MEMBER, subjectOnly: true },
  'evidence:attach': MEMBER,
  'proposal:create': MEMBER,

  // ─── Autorización horizontal ───────────────────────────────────────────────────────────────
  // Las tres siguientes son la razón de existir de este módulo. Un miembro y otro miembro tienen
  // exactamente el mismo rol; lo único que los separa es de quién es la cosa.
  'evidence:retract': { ...MEMBER, ownerOnly: true },
  'proposal:amend': { ...MEMBER, ownerOnly: true },
  'decision:cast-ballot': { ...MEMBER, subjectOnly: true },

  // ─── Procedimiento ─────────────────────────────────────────────────────────────────────────
  // §7: la facilitación «abre fases y verifica plazos». Garantías puede hacerlo también porque es
  // la última instancia; un miembro raso, no: abrir una votación es el acto más caro del sistema.
  'decision:open': {
    roles: ['facilitator', 'guarantees'],
    authenticated: true,
    ownerOnly: false,
    subjectOnly: false,
    readerOnly: false,
    circleOnly: true,
    deniedDuringStage: undefined,
  },
  'decision:close': {
    roles: ['facilitator', 'guarantees'],
    authenticated: true,
    ownerOnly: false,
    subjectOnly: false,
    readerOnly: false,
    circleOnly: true,
    deniedDuringStage: undefined,
  },
  'decision:ratify': {
    roles: ['facilitator', 'guarantees'],
    authenticated: true,
    ownerOnly: false,
    subjectOnly: false,
    readerOnly: false,
    circleOnly: true,
    deniedDuringStage: undefined,
  },
  'deliberation:open': {
    roles: ['facilitator', 'guarantees'],
    authenticated: true,
    ownerOnly: false,
    subjectOnly: false,
    readerOnly: false,
    circleOnly: true,
    deniedDuringStage: undefined,
  },
  'deliberation:contribute': CIRCLE_MEMBER,

  // ─── Reuniones (PRODUCT §4) ────────────────────────────────────────────────────────────────
  // Cualquiera lee: una convocatoria y un acta son públicas, igual que un problema o una
  // propuesta. `problem:create` es la referencia deliberada para `meeting:convene`: convocar es
  // un acto operativo (§4 fila 1 de GOVERNANCE, «decide quien tiene el encargo»), no un
  // procedimiento que exija facilitación, y no está atado al propio círculo por la misma razón
  // que `problem:create` no lo está — quien convoca puede nombrar el círculo competente sin
  // pertenecer a él, igual que quien abre un problema.
  //
  // Publicar el acta y enlazar el acuerdo con la propuesta que salió de él son horizontales, y la
  // referencia deliberada ahí es `proposal:amend`/`evidence:retract`: el mismo rol no da acceso a
  // lo ajeno. Quien convocó es quien responde por lo que se publica como constancia de lo que
  // pasó; otra persona del mismo círculo, con el mismo rol, no puede escribir el acta de una
  // reunión que no convocó.
  'meeting:read': OPEN,
  /*
   * `CIRCLE_MEMBER` y no `MEMBER`, y lo encontró la revisión independiente: con `MEMBER` a secas
   * cualquier persona autenticada podía convocar una reunión a nombre de un círculo al que NO
   * pertenece. Sólo se comprobaba que tuviera cuenta.
   *
   * No es un detalle de higiene. Una reunión convocada aparece en la pantalla del círculo, con su
   * orden del día, y lo que ahí se acuerde puede convertirse en propuesta del sistema: convocar es
   * un acto de gobierno del círculo, no un mensaje. Alguien de fuera podía citar a un órgano al que
   * no pertenece y meterle puntos en el orden del día.
   *
   * Publicar el acta y enlazar acuerdos ya exigían ser quien convocó (`ownerOnly`), así que el
   * agujero estaba sólo en la puerta de entrada — que es justo por donde importa.
   */
  'meeting:convene': CIRCLE_MEMBER,
  'meeting:publish-minutes': { ...MEMBER, ownerOnly: true },
  'meeting:link-agreement': { ...MEMBER, ownerOnly: true },

  'deliberation:advance-stage': {
    roles: ['facilitator', 'guarantees'],
    authenticated: true,
    ownerOnly: false,
    subjectOnly: false,
    readerOnly: false,
    circleOnly: true,
    deniedDuringStage: undefined,
  },

  // ADR-0049. La única regla de la matriz con alcance temporal, y por eso la más fácil de leer mal:
  // lo que deniega **no es el rol**, es la etapa. Mientras `perspectivas` sea la etapa vigente nadie
  // lee la autoría de nada —ni quien facilita, ni garantías—, y en cuanto la etapa avanza la lee
  // cualquier miembro del círculo. La protección es frente a los pares, incluido quien llame a la
  // API saltándose la interfaz; **no** frente a quien administra el servidor y lee la base de datos.
  //
  // DECISIÓN (reauditoría 2026-08-25): NO se amplía a `preguntas_aclaratorias`, aunque se consideró.
  //
  // El argumento a favor de ampliar es real: una pregunta también se lee distinto según quién la
  // firma, y hoy la autoría de `preguntas_aclaratorias` SÍ es legible mientras esa etapa sigue
  // vigente (sólo se oculta después, como efecto colateral de que la regla mira la etapa VIGENTE de
  // la deliberación entera y no la etapa en que se escribió cada aporte: en cuanto se abre
  // `perspectivas`, la autoría de las preguntas también queda tapada un rato, hasta que esa etapa
  // cierra). No se amplía por tres razones, ninguna de las tres nueva ni improvisada para esta
  // reauditoría:
  //
  //  1. **Los dos ADR que diseñaron esto lo dicen dos veces, no una.** ADR-0046 (§«Contexto»,
  //     líneas 39-40) nombra el detalle exacto que exige el mecanismo: «ocultar la autoría durante
  //     la etapa en que se recogen las perspectivas». ADR-0049, que retira el sellado criptográfico
  //     de ADR-0046 pero conserva su alcance, no amplía ese alcance en ningún momento: hereda
  //     `deniedDuringStage: 'perspectivas'` sin discutir `preguntas_aclaratorias`. Dos decisiones
  //     independientes, en dos fechas distintas, coinciden en el mismo límite. Eso no prueba que sea
  //     correcto, pero sí que no es un olvido: es donde las dos veces se trazó la línea a propósito.
  //  2. **`PRODUCT.md` traza la misma línea en la narrativa, no sólo en el código.** El recorrido
  //     «Días 14-16 · Preguntas» describe una etapa de hechos («la fase no cierra con preguntas sin
  //     responder, y "no hay dato" es una respuesta válida») sin una sola palabra sobre anonimato. El
  //     recorrido siguiente, «Días 17-23 · Deliberación», es el que introduce explícitamente el
  //     mecanismo anti-anclaje («no ve ninguna otra hasta enviarla... nadie ancla a nadie»). El sesgo
  //     que el pliego quiere evitar —«los tres primeros fijan el marco»— es un sesgo de OPINIÓN
  //     (quién se posiciona primero y con qué estatus), y `preguntas_aclaratorias` no reúne
  //     opiniones: reúne lo que hace falta entender antes de tenerlas. Tratar «pregunta» y
  //     «afirmación» como el mismo riesgo de sesgo porque ambas son `posicion` en el motor confunde
  //     el tipo de dato del dominio con el acto social que representa.
  //  3. **Ampliarla no repara nada del hueco que ya existe.** Quien participó en vivo durante
  //     `preguntas_aclaratorias` —facilitación incluida— ya vio quién preguntó qué antes de que
  //     `perspectivas` abriera; ese conocimiento no se puede retirar de la memoria de nadie tapando
  //     la pantalla después. Ampliar el alcance oscurecería una pregunta ya vista por cualquiera que
  //     leyó a tiempo, sin oscurecerla para quien de verdad importa. La única ampliación que
  //     protegería algo real sería ocultar la autoría DESDE que se escribe cada pregunta, lo cual
  //     exige seguir la etapa **de cada aporte**, no la etapa vigente de la deliberación: es un
  //     mecanismo distinto, con su propio costo, y no lo pide ningún documento del proyecto.
  //
  // Queda una prueba pinneada en `access.test.ts` («en `preguntas_aclaratorias` la autoría SÍ se
  // lee») como el contrato explícito de esta decisión, junto con la que ya fijaba lo mismo fuera de
  // este paquete (`tests/integration/http-deliberacion.test.ts`, `expect(cuerpo.autoriaVisible)
  // .toBe(true)` con la etapa en `preguntas_aclaratorias`). Si el día de mañana el pliego pide lo
  // contrario con una cita concreta, ampliar es un cambio de una palabra aquí —y de esas pruebas—,
  // no un rediseño.
  'deliberation:read-authorship': { ...CIRCLE_MEMBER, deniedDuringStage: 'perspectivas' },

  // ─── Constitución digital (§6) ─────────────────────────────────────────────────────────────
  // Ninguna de estas reglas lleva `circleOnly`, y no es un olvido: el cuerpo competente para las
  // reglas es la **Asamblea**, que es todo el censo (§3, fila 13 «vota todo el censo»). Exigir
  // pertenencia a un círculo sería inventar un requisito que el documento no pone y, peor, dejar
  // fuera de su propia constitución a quien no esté inscrito en ningún círculo.
  //
  // Y `tech-admin` no aparece en NINGUNA de las cinco de escritura. Es la tabla del §7 —«no puede
  // cambiar umbrales, quórums, plazos, pesos o dominios», «no puede firmar la puesta en vigor de
  // una reforma»— escrita donde se aplica.
  'constitution:read': OPEN,
  'constitution:found': {
    roles: ['facilitator', 'guarantees'],
    authenticated: true,
    ownerOnly: false,
    subjectOnly: false,
    readerOnly: false,
    circleOnly: false,
    deniedDuringStage: undefined,
  },
  // Proponer una reforma es un derecho de miembro: lo que la frena son las 30 firmas (10 % del
  // censo), que se cuentan en el dominio y no aquí. Un permiso de rol para proponer convertiría a
  // la facilitación en portera de lo que la asamblea puede discutir.
  'constitution:propose-reform': MEMBER,
  'constitution:record-vote': {
    roles: ['facilitator', 'guarantees'],
    authenticated: true,
    ownerOnly: false,
    subjectOnly: false,
    readerOnly: false,
    circleOnly: false,
    deniedDuringStage: undefined,
  },
  // §6.6: la puesta en vigor exige M de N firmas de Garantías. `subjectOnly` es lo que impide que
  // una sola persona escriba las tres: cada aprobación se atribuye a quien la hace. **No es una
  // firma criptográfica** —ver la cabecera de `constitution/commands.ts`—: quien administra el
  // servidor puede fabricarlas. Lo que hay es detección, no prevención, y está declarado.
  'constitution:approve': {
    roles: ['guarantees'],
    authenticated: true,
    ownerOnly: false,
    subjectOnly: true,
    readerOnly: false,
    circleOnly: false,
    deniedDuringStage: undefined,
  },
  'constitution:ratify': {
    roles: ['facilitator', 'guarantees'],
    authenticated: true,
    ownerOnly: false,
    subjectOnly: false,
    readerOnly: false,
    circleOnly: false,
    deniedDuringStage: undefined,
  },

  // ADR-0044: descomponer la iniciativa y volver a ofrecer trabajo pertenece a quien asumió el plan.
  'initiative:plan': OWNER_IN_CIRCLE,
  'task:offer': OWNER_IN_CIRCLE,
  'task:reoffer': OWNER_IN_CIRCLE,
  // Revisar es una decisión operativa del responsable inicial, no una facultad de facilitación.
  'task:request-changes': OWNER_IN_CIRCLE,
  'task:accept-review': OWNER_IN_CIRCLE,

  // Una oferta sólo la responde su destinatario vigente. Tener el mismo rol o facilitar el círculo
  // no permite aceptar, rechazar ni pedir reasignación por otra persona.
  'task:accept': SUBJECT_IN_CIRCLE,
  'task:reject': SUBJECT_IN_CIRCLE,
  'task:request-reassignment': SUBJECT_IN_CIRCLE,
  'task:start': SUBJECT_IN_CIRCLE,
  'task:block': SUBJECT_IN_CIRCLE,
  'task:request-help': SUBJECT_IN_CIRCLE,
  'task:resume': SUBJECT_IN_CIRCLE,
  'task:add-evidence': SUBJECT_IN_CIRCLE,
  'task:deliver': SUBJECT_IN_CIRCLE,
  'task:read-private-material': PRIVATE_READER_IN_CIRCLE,
};

/** La regla aplicable a una acción. Expuesta para poder explicarla en la interfaz, no para saltarla. */
export function ruleFor(action: Action): Rule {
  return RULES[action];
}

/**
 * ¿Puede `actor` hacer `action` sobre `resource`? Lanza `UnauthorizedError` si no.
 *
 * El orden de las comprobaciones importa para el mensaje, no para el resultado: primero identidad
 * y rol; ownership/sujeto; círculo vigente; y al final la lista de lectores, que puede depender de
 * que exista el material. No hay ninguna combinación que conceda acceso por omitir un dato.
 */
export function authorize(actor: Actor, action: Action, resource: ResourceRef): void {
  const rule = RULES[action];

  if (rule.authenticated && actor.memberId === undefined) {
    throw new UnauthorizedError(
      'NOT_AUTHENTICATED',
      action,
      'este acto exige una cuenta verificada con el correo institucional',
    );
  }

  if (!actor.roles.some((role) => rule.roles.includes(role))) {
    throw new UnauthorizedError(
      'ROLE_NOT_GRANTED',
      action,
      `se exige alguno de [${rule.roles.join(', ')}] y el actor tiene [${actor.roles.join(', ')}]`,
    );
  }

  if (rule.ownerOnly) {
    if (resource.owner === undefined) {
      // Fallar cerrado. Un recurso sin autor declarado no es «de todos»: es un dato que falta, y
      // dejar pasar por ausencia de dato es cómo se cuela la escalada horizontal.
      throw new UnauthorizedError(
        'OWNER_UNKNOWN',
        action,
        `el ${resource.kind} no declara autor, y esta acción sólo la puede hacer quien lo escribió`,
      );
    }
    if (resource.owner !== actor.memberId) {
      throw new UnauthorizedError(
        'NOT_THE_OWNER',
        action,
        `el ${resource.kind} lo escribió otra persona; tener el mismo rol no da acceso a lo ajeno`,
      );
    }
  }

  if (rule.subjectOnly) {
    if (resource.subject === undefined) {
      throw new UnauthorizedError(
        'OWNER_UNKNOWN',
        action,
        `el acto no declara a quién se atribuye, y esta acción sólo puede atribuirse a quien la hace`,
      );
    }
    if (resource.subject !== actor.memberId) {
      throw new UnauthorizedError(
        'NOT_THE_SUBJECT',
        action,
        'nadie actúa en nombre de otra persona: este acto se atribuiría a alguien que no sos vos',
      );
    }
  }

  if (rule.circleOnly) {
    if (resource.circleId === undefined) {
      throw new UnauthorizedError(
        'NOT_IN_CIRCLE',
        action,
        'el recurso no declara círculo competente y esta acción se decide por círculo (§3)',
      );
    }
    if (!actor.circles.includes(resource.circleId)) {
      throw new UnauthorizedError(
        'NOT_IN_CIRCLE',
        action,
        'quien cuida el procedimiento de un círculo tiene que pertenecer a ese círculo (§3)',
      );
    }
  }

  // Después del círculo: quien no pertenece al círculo no debe enterarse de en qué etapa va una
  // deliberación ajena por el motivo de su denegación.
  if (rule.deniedDuringStage !== undefined) {
    if (resource.stage === undefined) {
      throw new UnauthorizedError(
        'STAGE_UNKNOWN',
        action,
        'el recurso no declara la etapa vigente y esta acción se decide por etapa: sin ese dato ' +
          'se deniega, porque la ausencia de política nunca concede acceso',
      );
    }
    if (resource.stage === rule.deniedDuringStage) {
      throw new UnauthorizedError(
        'STAGE_STILL_OPEN',
        action,
        `mientras la etapa ${rule.deniedDuringStage} siga vigente este dato no se lee, y no hay ` +
          'ningún rol que lo cambie: la regla es de etapa, no de jerarquía',
      );
    }
  }

  // La membresía se comprueba antes que esta lista dependiente del material: una persona que fue
  // autora pero salió del círculo no debe distinguir un ID real de uno inexistente por el error.
  if (rule.readerOnly) {
    if (resource.authorizedReaders === undefined || resource.authorizedReaders.length === 0) {
      throw new UnauthorizedError(
        'READERS_UNKNOWN',
        action,
        'el material privado no declara lectores; la ausencia de política nunca concede acceso',
      );
    }
    // `actor.memberId === undefined` es defensivo y hoy INALCANZABLE: en la matriz, `readerOnly`
    // sólo lo lleva `PRIVATE_READER_IN_CIRCLE`, y esa regla es siempre `authenticated: true`. La
    // comprobación de arriba ya lanzó `NOT_AUTHENTICATED` antes de llegar acá si `memberId` faltaba
    // (§10, mutación sobre `permisos`: mutante demostrado equivalente, no deuda de prueba). Queda
    // escrito y no se borra porque documenta la invariante que lo vuelve inalcanzable —el día que
    // una regla con `readerOnly` no exija identidad, este disyunto vuelve a hacer falta de verdad.
    if (actor.memberId === undefined || !resource.authorizedReaders.includes(actor.memberId)) {
      throw new UnauthorizedError(
        'NOT_A_READER',
        action,
        'la identidad no está autorizada para abrir este material privado',
      );
    }
  }
}

/** Variante no excepcional, para pintar u ocultar botones. **Nunca** para decidir si se escribe. */
export function can(actor: Actor, action: Action, resource: ResourceRef): boolean {
  try {
    authorize(actor, action, resource);
    return true;
  } catch (error) {
    if (error instanceof UnauthorizedError) return false;
    throw error;
  }
}

/** Motivo de la denegación, o `undefined`. Para explicar en palabras, no en códigos. */
export function denialReason(
  actor: Actor,
  action: Action,
  resource: ResourceRef,
): DenialReason | undefined {
  try {
    authorize(actor, action, resource);
    return undefined;
  } catch (error) {
    if (error instanceof UnauthorizedError) return error.reason;
    throw error;
  }
}
