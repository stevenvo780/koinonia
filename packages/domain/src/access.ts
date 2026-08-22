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
 * ═══ Qué NO decide este módulo ═══
 *
 * La elegibilidad para votar **no** es autorización: se decide contra el padrón congelado
 * (`electorate.ts`, INV-02) y no contra los roles vivos de nadie. Un miembro con rol vigente que no
 * está en el padrón de esa decisión no vota, y alguien que se retiró después de la congelación sí.
 * Mezclar las dos cosas sería reintroducir el padrón móvil por la puerta de atrás.
 */

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
  | 'deliberation:reveal-authorship'
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
  'deliberation:reveal-authorship',
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
  'circle' | 'problem' | 'evidence' | 'proposal' | 'decision' | 'initiative' | 'task' | 'ledger';

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
  | 'OWNER_UNKNOWN';

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
}

const OPEN: Rule = {
  roles: ROLES,
  authenticated: false,
  ownerOnly: false,
  subjectOnly: false,
  readerOnly: false,
  circleOnly: false,
};

const MEMBER: Rule = {
  roles: ['member', 'facilitator', 'guarantees'],
  authenticated: true,
  ownerOnly: false,
  subjectOnly: false,
  readerOnly: false,
  circleOnly: false,
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
  },
  'decision:close': {
    roles: ['facilitator', 'guarantees'],
    authenticated: true,
    ownerOnly: false,
    subjectOnly: false,
    readerOnly: false,
    circleOnly: true,
  },
  'decision:ratify': {
    roles: ['facilitator', 'guarantees'],
    authenticated: true,
    ownerOnly: false,
    subjectOnly: false,
    readerOnly: false,
    circleOnly: true,
  },
  'deliberation:open': {
    roles: ['facilitator', 'guarantees'],
    authenticated: true,
    ownerOnly: false,
    subjectOnly: false,
    readerOnly: false,
    circleOnly: true,
  },
  'deliberation:contribute': CIRCLE_MEMBER,
  'deliberation:advance-stage': {
    roles: ['facilitator', 'guarantees'],
    authenticated: true,
    ownerOnly: false,
    subjectOnly: false,
    readerOnly: false,
    circleOnly: true,
  },
  'deliberation:reveal-authorship': {
    roles: ['guarantees'],
    authenticated: true,
    ownerOnly: false,
    subjectOnly: false,
    readerOnly: false,
    circleOnly: true,
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
