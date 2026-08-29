/**
 * Errores tipados del dominio.
 *
 * Principio 0.1.5 de la especificación 30 — **fallar cerrado**: ante una entrada inválida el motor
 * rechaza el evento; jamás «interpreta caritativamente». Por eso cada rechazo tiene una clase y un
 * `code` estable: la capa de aplicación decide qué mostrar, pero no puede confundir un padrón mal
 * formado con una papeleta fuera de plazo.
 *
 * Ninguna de estas clases lleva datos personales: el dominio no los conoce (resolución R1).
 */

/** Raíz de todos los rechazos del dominio. Nunca se lanza directamente. */
export class DomainError extends Error {
  /** Código estable, apto para i18n y para el log. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

/** Un identificador no tiene la forma exigida (32 hex minúscula, 64 para un hash…). */
export class InvalidIdError extends DomainError {
  readonly kind: string;
  readonly received: string;

  constructor(kind: string, received: string, expected: string) {
    super(
      'INVALID_ID',
      `${kind} inválido: se esperaba ${expected} y se recibió ${JSON.stringify(received)}`,
    );
    this.name = 'InvalidIdError';
    this.kind = kind;
    this.received = received;
  }
}

/** Una fracción exacta con denominador no positivo, numerador negativo o fuera de rango. */
export class InvalidFractionError extends DomainError {
  constructor(message: string) {
    super('INVALID_FRACTION', message);
    this.name = 'InvalidFractionError';
  }
}

/** El padrón congelado no está bien formado (INV-06) o la congelación es imposible. */
export class InvalidElectorateError extends DomainError {
  constructor(reason: string) {
    super('INVALID_ELECTORATE', `padrón inválido: ${reason}`);
    this.name = 'InvalidElectorateError';
  }
}

/** Motivos de rechazo de una `DecisionConfig`. Cada uno cita la decisión normativa que lo impone. */
export type ConfigRejection =
  | 'ENGINE_VERSION_MISMATCH'
  | 'EMPTY_CENSUS'
  | 'NO_OPTIONS'
  | 'OPTIONS_NOT_SORTED'
  | 'BINARY_METHOD_NEEDS_SINGLE_OPTION'
  | 'MULTI_METHOD_NEEDS_TWO_OPTIONS'
  | 'TOPICS_NOT_SORTED'
  | 'WINDOW_INVERTED'
  | 'NEGATIVE_CHALLENGE_WINDOW'
  | 'CENSUS_BASE_NOT_ALLOWED'
  | 'PRESENT_BASE_UNSUPPORTED'
  | 'REDUNDANT_APPROVAL_QUORUM'
  | 'UNANIMITY_NOT_AUTHORIZED'
  /** Se conserva por compatibilidad de códigos: la PARTE C ya está implementada y no se emite. */
  | 'DELEGATION_NOT_IMPLEMENTED'
  | 'SECRET_BALLOT_WITH_DELEGATION'
  | 'DELEGATION_VALIDITY_TOO_LONG'
  | 'DELEGATION_CAP_TOO_SMALL'
  | 'CONSTITUENT_ACT_NEEDS_MIN_DIRECT'
  | 'MAX_ROUNDS_OUT_OF_RANGE'
  | 'MAX_EXTENSIONS_OUT_OF_RANGE'
  | 'EXTENSION_DURATION_INVALID'
  | 'FRACTION_OUT_OF_RANGE'
  | 'EARLY_CLOSE_NOT_ALLOWED'
  | 'CONSENT_CIRCLE_EMPTY'
  | 'TEXT_NOT_CANONICAL'
  | 'CONFIG_HASH_MISMATCH'
  | 'ELECTORATE_NOT_FROZEN_AT_OPENING';

/** La configuración de la decisión no puede abrirse tal como está. */
export class InvalidConfigError extends DomainError {
  readonly rejection: ConfigRejection;

  constructor(rejection: ConfigRejection, detail: string) {
    super(`CONFIG_${rejection}`, `configuración inválida (${rejection}): ${detail}`);
    this.name = 'InvalidConfigError';
    this.rejection = rejection;
  }
}

/**
 * **Compuerta C6 — secreto duro no soportado.**
 *
 * `docs/research/00-contradicciones-resueltas.md` §C6: el documento normativo exige que el vínculo
 * voto↔votante **no exista en ningún almacén**, ni siquiera para quien administra el servidor; el
 * diseño del MVP entrega exactamente lo que ese requisito descalifica como «voto público con
 * control de acceso». La resolución del arquitecto cierra la contradicción por la vía honesta: el
 * motor **no acepta** decisiones que pidan ese secreto. Se derivan a votación en papel.
 *
 * No es una bandera desactivable por configuración: es la primera comprobación de `openDecision`,
 * anterior a toda validación, para que ninguna combinación de parámetros pueda evitarla.
 */
export class HardSecrecyUnsupported extends DomainError {
  readonly privacy: string;

  constructor(privacy: string) {
    super(
      'HARD_SECRECY_UNSUPPORTED',
      `el modo de privacidad ${JSON.stringify(privacy)} exige secreto frente a quien administra ` +
        'el servidor, y esta versión de Koinonía no puede darlo (C6). Ese asunto debe votarse en ' +
        'papel; la plataforma no simula una protección que no tiene.',
    );
    this.name = 'HardSecrecyUnsupported';
    this.privacy = privacy;
  }
}

/** Transición de la máquina de estados no contemplada en la tabla A.8.1. */
export class IllegalTransitionError extends DomainError {
  readonly from: string;
  readonly eventType: string;

  constructor(from: string, eventType: string, detail?: string) {
    super(
      'ILLEGAL_TRANSITION',
      `transición ilegal: ${eventType} no es aplicable en el estado ${from}` +
        (detail === undefined ? '' : ` (${detail})`),
    );
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.eventType = eventType;
  }
}

/** Motivos por los que una papeleta se rechaza. */
export type BallotRejection =
  | 'WRONG_DECISION'
  | 'INELIGIBLE_VOTER'
  | 'OUT_OF_WINDOW'
  | 'STALE_PROPOSAL_VERSION'
  | 'WRONG_ROUND'
  | 'INVALID_SEQ'
  | 'PAYLOAD_KIND_NOT_ACCEPTED'
  | 'OBJECTION_REQUIRED'
  | 'OBJECTION_NOT_ALLOWED'
  | 'OBJECTION_ARGUMENT_TOO_SHORT'
  | 'OBJECTION_AIM_MISSING'
  | 'OBJECTION_ROUND_MISMATCH'
  | 'TEXT_NOT_CANONICAL'
  | 'VOIDED';

/** La papeleta no entra en el log. Nunca se «arregla»: se rechaza (principio 0.1.5). */
export class InvalidBallotError extends DomainError {
  readonly rejection: BallotRejection;

  constructor(rejection: BallotRejection, detail: string) {
    super(`BALLOT_${rejection}`, `papeleta rechazada (${rejection}): ${detail}`);
    this.name = 'InvalidBallotError';
    this.rejection = rejection;
  }
}

/**
 * Un escrutador recibió una papeleta de una clase que su método no admite (INV-12).
 *
 * En un log legal esto es inalcanzable —`castBallot` ya lo rechazó y `effectiveBallots` lo filtra—,
 * y precisamente por eso se lanza: si ocurre, el log fue manipulado o el motor tiene un bug, y en
 * ninguno de los dos casos se debe publicar un resultado.
 */
export class InvalidBallotForMethod extends DomainError {
  readonly payloadKind: string;
  readonly methodKind: string;

  constructor(payloadKind: string, methodKind: string) {
    super(
      'INVALID_BALLOT_FOR_METHOD',
      `una papeleta de tipo ${payloadKind} no se convierte a ${methodKind}: se rechaza`,
    );
    this.name = 'InvalidBallotForMethod';
    this.payloadKind = payloadKind;
    this.methodKind = methodKind;
  }
}

/** El estado del agregado no permite la orden pedida (más fino que la máquina de estados). */
export class PreconditionError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = 'PreconditionError';
  }
}

/** `sha256(seed) !== seedCommitment` (A.8.2.8). Dispara anulación automática aguas arriba. */
export class SeedCommitmentMismatch extends DomainError {
  constructor(expected: string, actual: string) {
    super(
      'SEED_COMMITMENT_MISMATCH',
      `la semilla revelada no corresponde al compromiso: se esperaba ${expected} y se obtuvo ${actual}`,
    );
    this.name = 'SeedCommitmentMismatch';
  }
}

/** La cadena de hashes del log está rota (INV-19): el agregado queda en cuarentena. */
export class BrokenLogError extends DomainError {
  readonly atSeq: number;

  constructor(atSeq: number, detail: string) {
    super('BROKEN_LOG', `log corrupto en seq=${String(atSeq)}: ${detail}`);
    this.name = 'BrokenLogError';
    this.atSeq = atSeq;
  }
}
