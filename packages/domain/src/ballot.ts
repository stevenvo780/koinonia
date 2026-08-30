/**
 * `Ballot` — papeleta polimórfica (A.4).
 *
 * Esta entrega implementa las papeletas de los cuatro métodos entregados: la **aprobación simple**
 * (`binary`), la **abstención explícita** (`abstain`) y el **consentimiento con objeción**
 * (`consent`). Las cuatro restantes de A.4 —`approval`, `score`, `ranking`, `grades`— entran con sus
 * métodos en la entrega siguiente; la unión discriminada es el punto de extensión.
 *
 * ═══ Tres reglas que parecen detalles y no lo son ═══
 *
 * - **A.4 / DECISIÓN A.4:** la papeleta **no** almacena el peso de voto. El peso se resuelve durante
 *   el escrutinio, con el estado de delegaciones vigente en el instante de cierre. Si el peso se
 *   congelara al emitir, una revocación posterior no tendría efecto sobre una papeleta ya emitida,
 *   contradiciendo «revocable en cualquier momento».
 * - **DECISIÓN A.5 — idempotencia por última papeleta:** un miembro puede emitir varias papeletas
 *   mientras la decisión esté `Open`; sólo cuenta la de mayor `seq` para esa `(decisionId, voter,
 *   round)`. Cambiar de opinión tras leer la deliberación es una virtud, no un fraude, y «la última
 *   manda» es trivialmente auditable y hace que un reintento de red no duplique un voto (INV-07).
 * - **DECISIÓN A.6 — `proposalVersionHash` obligatorio:** consentir un texto es consentir *ese*
 *   texto. Arrastrar consentimientos a un texto enmendado es falsificar la voluntad, y es el fallo
 *   más común de las herramientas de consenso (INV-09).
 *
 * ═══ Fallar cerrado ═══
 *
 * INV-12: una papeleta de tipo incompatible **se rechaza, no se convierte**. No existe «un `ranking`
 * cuya primera preferencia se toma como aprobación» ni «un `score ≥ 3` que se lee como sí»: eso
 * inventa una preferencia que nadie expresó.
 */

import {
  type DecisionConfig,
  type DecisionMethod,
  type GradeId,
  isThresholdMethod,
} from './config.js';
import { type Electorate, isEligible } from './electorate.js';
import { InvalidBallotError } from './errors.js';
import type {
  BallotId,
  DecisionId,
  Hash,
  Instant,
  MemberId,
  ObjectionId,
  OptionId,
} from './ids.js';
import { type EffectiveWindow, isWithinWindow } from './window.js';

/** Postura en el consentimiento sociocrático. */
export type ConsentStance = 'consent' | 'concern' | 'object';

export type Score = 0 | 1 | 2 | 3 | 4 | 5;

/** Longitud mínima del argumento de una objeción, tras normalizar espacios (A.4). */
export const MIN_OBJECTION_ARGUMENT_LENGTH = 40;

/**
 * Una objeción es una **alegación de daño al fin común**, no una expresión de preferencia. Por eso
 * `harmedAim` es obligatorio: ancla la objeción en un objetivo declarado del círculo (B.3).
 */
export interface Objection {
  readonly objectionId: ObjectionId;
  /** Texto obligatorio. Mínimo 40 caracteres tras normalizar espacios. */
  readonly argument: string;
  /** Qué objetivo del círculo se daña. Obligatorio. */
  readonly harmedAim: string;
  /** Propuesta de enmienda. Opcional, pero fuertemente incentivada en la interfaz. */
  readonly proposedAmendment?: string;
  readonly raisedAtRound: number;
}

/**
 * Una nota por opción, en la papeleta de puntuación. La opción que no aparece en la lista es «sin
 * opinión»: no cuenta como cero (B.5.a) y no hace falta nombrarla con un valor nulo.
 */
export interface ScoreEntry {
  readonly option: OptionId;
  readonly value: Score;
}

/** Una mención por opción, en la papeleta de valoración por menciones. */
export interface GradeEntry {
  readonly option: OptionId;
  readonly grade: GradeId;
}

export type BallotPayload =
  /** Abstención EXPLÍCITA. Distinta del silencio, que es no emitir papeleta. */
  | { readonly kind: 'abstain' }
  /** Sí/No para mayoría, supermayoría y unanimidad. */
  | { readonly kind: 'binary'; readonly approve: boolean }
  /**
   * Puntuación 0–5, como LISTA de pares `{option, value}` y no como mapa con la opción de clave.
   *
   * No es una preferencia de estilo: toda papeleta se escribe en el historial pasando por el
   * serializador canónico del ledger (`packages/crypto/src/canonical.ts`), que exige que las
   * claves de objeto empiecen por letra y prohíbe `null` como cualquier valor. Un `OptionId` es 32
   * hexadecimales al azar —cerca del 62 % empieza por dígito—, así que usarlo de clave revienta el
   * hasheo la mayoría de las veces, y «sin opinión» no se puede escribir como `null` de ninguna
   * forma. La lista no tiene ninguno de los dos problemas: `option` es un VALOR, y la opción sin
   * opinión simplemente no aparece — `validateBallot` y `tally/score.ts` la leen igual que si
   * hubiera un `null` explícito, que es como se leía antes de este cambio.
   */
  | { readonly kind: 'score'; readonly scores: readonly ScoreEntry[] }
  /** Orden estricto, posiblemente parcial cuando el método lo permite. */
  | { readonly kind: 'ranking'; readonly order: readonly OptionId[] }
  /**
   * Una mención por opción, como LISTA de pares `{option, grade}` — misma razón que `scores`
   * arriba. Con política `worst` se permiten opciones ausentes de la lista.
   */
  | { readonly kind: 'grades'; readonly grades: readonly GradeEntry[] }
  /** Consentimiento sociocrático. `objection` es obligatoria ⟺ `stance === 'object'`. */
  | {
      readonly kind: 'consent';
      readonly stance: ConsentStance;
      readonly objection?: Objection;
    }
  /**
   * Un consejo, en el proceso de consejo (B.9). No es un voto y no se cuenta como tal.
   *
   * `reasoning` es OBLIGATORIO y no por formalismo: un consejo sin razones no es un consejo, es un
   * voto disfrazado — y este método existe justamente porque hay decisiones que no se votan. Quien
   * decide tiene que poder leer POR QUÉ, que es lo único que puede cambiarle la cabeza.
   */
  | {
      readonly kind: 'advice';
      readonly stance: AdviceStance;
      readonly reasoning: string;
    };

/**
 * Qué dice un consejo, en grueso.
 *
 * Tres y no dos: `matiz` es el que hace que esto no sea un sí/no con otro nombre. La mayoría de los
 * consejos útiles no son «hacelo» ni «no lo hagas», son «hacelo, pero mirá esto antes».
 */
export type AdviceStance = 'a-favor' | 'en-contra' | 'matiz';

/** Lo mínimo que se le exige a un consejo escrito, en caracteres. */
export const MIN_LARGO_DEL_CONSEJO = 40;

export type BallotPayloadKind = BallotPayload['kind'];

export interface Ballot {
  readonly ballotId: BallotId;
  readonly decisionId: DecisionId;
  /** Autor. Identificador opaco: el dominio no conoce nombres ni correos (R1). */
  readonly voter: MemberId;
  /** Ronda a la que pertenece. 1 en los métodos de una sola ronda. */
  readonly round: number;
  readonly payload: BallotPayload;
  /** Instante asignado por el SERVIDOR al aceptar el evento (D.3.c). */
  readonly castAt: Instant;
  /** `seq` del evento `BallotCast`. Orden canónico total (A.9). */
  readonly seq: number;
  /** Hash de la versión exacta de la propuesta que el votante tenía a la vista (A.6). */
  readonly proposalVersionHash: Hash;
}

/** Papeleta tal como llega, antes de que el servidor le asigne `castAt` y `seq`. */
export type BallotDraft = Omit<Ballot, 'castAt' | 'seq'>;

/**
 * Qué clases de papeleta admite cada método.
 *
 * DECISIÓN: `sociocratic-consent` **no** admite `abstain`. El conjunto de posturas de B.3 es cerrado
 * —`consent | concern | object`— y el `engagement` se define sobre él; una `abstain` sería una quinta
 * cosa cuyo efecto sobre el `engagement` la especificación no define. Antes que inventar una
 * semántica, se rechaza: quien no quiere pronunciarse, calla (y `silenceMeans` decide qué significa
 * callar), y quien quiere dejar constancia de reserva sin bloquear tiene exactamente `concern`, que
 * es para lo que existe.
 */
export function acceptedPayloadKinds(method: DecisionMethod): readonly BallotPayloadKind[] {
  if (isThresholdMethod(method)) return ['binary', 'abstain'] as const;
  switch (method.kind) {
    case 'sociocratic-consent':
      return ['consent'] as const;
    /*
     * Las dos, y cada una para quien le toca: los demás aconsejan, quien decide decide. Que la
     * decisión sea una papeleta `binary` no la convierte en un voto — es una entre miles y la única
     * que el escrutinio mira. `validateBallot` impide que la emita alguien que no sea quien decide.
     */
    case 'advice-process':
      return ['advice', 'binary'] as const;
    case 'score':
      return ['score'] as const;
    case 'irv':
    case 'condorcet-schulze':
      return ['ranking'] as const;
    case 'majority-judgment':
      return ['grades'] as const;
    case 'deliberative-sortition':
      return [] as const;
  }
}

/**
 * Las opciones de una lista de pares `{option, …}`, o `undefined` si alguna se repite.
 *
 * Repetida sería un dato ambiguo —¿cuál de las dos cuenta?— y esta función lo hace irrepresentable
 * en vez de resolverlo con un criterio inventado (¿la primera? ¿la última?): `validateBallot`
 * rechaza la papeleta entera cuando esto devuelve `undefined`.
 */
function optionsOf(entries: readonly { readonly option: OptionId }[]): Set<OptionId> | undefined {
  const seen = new Set<OptionId>();
  for (const entry of entries) {
    if (seen.has(entry.option)) return undefined;
    seen.add(entry.option);
  }
  return seen;
}

function sameOptionSet(actual: ReadonlySet<OptionId>, expected: readonly OptionId[]): boolean {
  return actual.size === expected.length && expected.every((option) => actual.has(option));
}

/** Contexto de validación: lo que el estado de la decisión aporta a la papeleta. */
export interface BallotContext {
  readonly window: EffectiveWindow;
  /** Ronda vigente. */
  readonly round: number;
  /** Versión de la propuesta vigente en esa ronda. */
  readonly proposalVersionHash: Hash;
}

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function assertLedgerText(text: string, what: string): void {
  if (text.normalize('NFC') !== text) {
    throw new InvalidBallotError(
      'TEXT_NOT_CANONICAL',
      `${what} debe venir normalizado en NFC: dos textos que se ven idénticos y hashean distinto ` +
        'rompen la verificación (A.1.1)',
    );
  }
  if (text.includes('\r')) {
    throw new InvalidBallotError(
      'TEXT_NOT_CANONICAL',
      `${what} contiene CR: los finales de línea se normalizan a LF en el borde de entrada`,
    );
  }
}

/** Valida la objeción por sus tres preguntas de admisibilidad (B.3). */
export function validateObjection(objection: Objection, round: number): void {
  assertLedgerText(objection.argument, 'el argumento de la objeción');
  assertLedgerText(objection.harmedAim, 'el objetivo dañado');
  if (objection.proposedAmendment !== undefined) {
    assertLedgerText(objection.proposedAmendment, 'la enmienda propuesta');
  }
  if (normalizeSpaces(objection.argument).length < MIN_OBJECTION_ARGUMENT_LENGTH) {
    throw new InvalidBallotError(
      'OBJECTION_ARGUMENT_TOO_SHORT',
      `una objeción exige al menos ${String(MIN_OBJECTION_ARGUMENT_LENGTH)} caracteres de ` +
        'argumento: bloquear a la comunidad tiene que costar, como mínimo, explicarse (B.3)',
    );
  }
  if (normalizeSpaces(objection.harmedAim) === '') {
    throw new InvalidBallotError(
      'OBJECTION_AIM_MISSING',
      'una objeción es una alegación de daño al fin común: sin objetivo dañado es una preferencia',
    );
  }
  if (objection.raisedAtRound !== round) {
    throw new InvalidBallotError(
      'OBJECTION_ROUND_MISMATCH',
      `la objeción dice pertenecer a la ronda ${String(objection.raisedAtRound)} y la papeleta a ` +
        `la ronda ${String(round)}`,
    );
  }
}

/**
 * Validación completa de una papeleta contra la configuración y el estado. Lanza `InvalidBallotError`
 * al primer problema: el motor **rechaza el evento**, no lo corrige (principio 0.1.5).
 */
export function validateBallot(
  config: DecisionConfig,
  ballot: Ballot,
  context: BallotContext,
): void {
  if (ballot.decisionId !== config.decisionId) {
    throw new InvalidBallotError(
      'WRONG_DECISION',
      `la papeleta apunta a ${ballot.decisionId} y la decisión es ${config.decisionId}`,
    );
  }
  if (!Number.isSafeInteger(ballot.seq) || ballot.seq < 1) {
    throw new InvalidBallotError('INVALID_SEQ', 'seq debe ser un entero ≥ 1 (A.7)');
  }
  // INV-02: la elegibilidad se decide contra el padrón CONGELADO, jamás contra el registro vivo.
  if (!isEligible(config.electorate, ballot.voter)) {
    throw new InvalidBallotError(
      'INELIGIBLE_VOTER',
      `${ballot.voter} no está en el padrón congelado (rollHash ${config.electorate.rollHash})`,
    );
  }
  // INV-10 y D.3.b: `[opensAt, closesAt)`, sin gracia.
  if (!isWithinWindow(ballot.castAt, context.window)) {
    throw new InvalidBallotError(
      'OUT_OF_WINDOW',
      `castAt=${String(ballot.castAt)} está fuera de [${String(context.window.opensAt)}, ` +
        `${String(context.window.closesAt)}): el cierre es exclusivo y no hay período de gracia`,
    );
  }
  if (ballot.round !== context.round) {
    throw new InvalidBallotError(
      'WRONG_ROUND',
      `la papeleta es de la ronda ${String(ballot.round)} y la ronda vigente es ` +
        String(context.round),
    );
  }
  // INV-09: consentir un texto es consentir *ese* texto.
  if (ballot.proposalVersionHash !== context.proposalVersionHash) {
    throw new InvalidBallotError(
      'STALE_PROPOSAL_VERSION',
      'la papeleta se emitió sobre una versión de la propuesta que ya no es la vigente (A.6)',
    );
  }

  const accepted = acceptedPayloadKinds(config.method);
  if (!accepted.includes(ballot.payload.kind)) {
    // INV-12: se rechaza, no se convierte.
    throw new InvalidBallotError(
      'PAYLOAD_KIND_NOT_ACCEPTED',
      `${config.method.kind} admite ${accepted.join(' | ')} y la papeleta es de tipo ` +
        `${ballot.payload.kind}; convertirla inventaría una preferencia que nadie expresó`,
    );
  }

  /*
   * Proceso de consejo: quién puede emitir cada cosa.
   *
   * Va en el DOMINIO y no en la pantalla, por lo mismo que la guarda de los métodos comparativos:
   * una regla que sólo aplica el navegador es una sugerencia, y quien llame a la API se la salta.
   * Si cualquiera pudiera emitir la papeleta binaria, el escrutinio la ignoraría —sólo mira la de
   * quien decide— pero el historial se llenaría de decisiones que nadie tomó, y alguien que lea el
   * registro no podría distinguirlas de la buena.
   */
  if (config.method.kind === 'advice-process') {
    const { decider } = config.method;
    if (ballot.payload.kind === 'binary' && ballot.voter !== decider) {
      throw new InvalidBallotError(
        'NOT_THE_DECIDER',
        'en el proceso de consejo decide una sola persona, y no sos vos: lo que podés aportar es ' +
          'consejo, que es lo que este método hace obligatorio escuchar',
      );
    }
    if (ballot.payload.kind === 'advice') {
      if (ballot.voter === decider) {
        throw new InvalidBallotError(
          'DECIDER_CANNOT_ADVISE',
          'quien decide no se aconseja a sí misma: su papeleta es la decisión, y contarla como ' +
            'consejo dejaría que se cumpliera el mínimo con su propia voz',
        );
      }
      if (ballot.payload.reasoning.trim().length < MIN_LARGO_DEL_CONSEJO) {
        throw new InvalidBallotError(
          'ADVICE_WITHOUT_REASONS',
          `un consejo se explica: hacen falta al menos ${String(MIN_LARGO_DEL_CONSEJO)} ` +
            'caracteres. Sin razones no es consejo, es un voto disfrazado — y esto no es una votación',
        );
      }
    }
  }

  if (ballot.payload.kind === 'consent') {
    const { stance, objection } = ballot.payload;
    if (stance === 'object' && objection === undefined) {
      throw new InvalidBallotError(
        'OBJECTION_REQUIRED',
        'objetar exige presentar la objeción por escrito: qué objetivo se daña y por qué (B.3)',
      );
    }
    if (stance !== 'object' && objection !== undefined) {
      throw new InvalidBallotError(
        'OBJECTION_NOT_ALLOWED',
        `una papeleta con postura ${stance} no puede traer una objeción adjunta`,
      );
    }
    if (objection !== undefined) validateObjection(objection, ballot.round);
  }

  if (ballot.payload.kind === 'score') {
    // DECISIÓN (revisada): antes se exigía una clave por cada opción viva, con `null` para «sin
    // opinión» — «faltar una opción se rechazaba igual que sobrar una». Esa exigencia dejó de ser
    // satisfacible el día que la papeleta tuvo que dejar de escribir `null` en el historial: el
    // perfil canónico del ledger lo prohíbe (`packages/crypto/src/canonical.ts`, A.1.1.2), así que
    // una papeleta «sin opinión en algo» válida según la regla vieja no se podía persistir jamás.
    // La única forma honesta de decir «no opiné sobre esto» pasa a ser OMITIR la opción de la
    // lista, ni más ni menos de lo que `scoreProfiles` (`tally/score.ts`) ya hacía con una opción
    // ausente: la trataba exactamente igual que un `null` explícito. Lo único que sigue
    // exigiéndose es que cada opción presente sea una opción viva de la decisión, y que no se
    // repita: puntuar algo que no está en la papeleta, o puntuarlo dos veces, es un error, no una
    // opinión.
    const entries = ballot.payload.scores;
    const options = optionsOf(entries);
    if (options === undefined) {
      throw new InvalidBallotError(
        'PAYLOAD_KIND_NOT_ACCEPTED',
        'la papeleta de puntuación repite la misma opción más de una vez',
      );
    }
    for (const option of options) {
      if (!config.options.includes(option)) {
        throw new InvalidBallotError(
          'PAYLOAD_KIND_NOT_ACCEPTED',
          'la papeleta de puntuación contiene una opción ajena a la decisión (B.5)',
        );
      }
    }
    for (const entry of entries) {
      if (!Number.isSafeInteger(entry.value) || entry.value < 0 || entry.value > 5) {
        throw new InvalidBallotError(
          'PAYLOAD_KIND_NOT_ACCEPTED',
          `la puntuación de ${entry.option} debe estar en [0,5]`,
        );
      }
    }
  }

  if (ballot.payload.kind === 'ranking') {
    const order = ballot.payload.order;
    const unique = new Set(order);
    if (order.length === 0 || unique.size !== order.length) {
      throw new InvalidBallotError(
        'PAYLOAD_KIND_NOT_ACCEPTED',
        'el ranking debe ser un orden estricto no vacío, sin opciones repetidas',
      );
    }
    if (order.some((option) => !config.options.includes(option))) {
      throw new InvalidBallotError(
        'PAYLOAD_KIND_NOT_ACCEPTED',
        'el ranking contiene una opción que no pertenece a la decisión',
      );
    }
    const method = config.method;
    if (
      (method.kind === 'irv' || method.kind === 'condorcet-schulze') &&
      !method.allowTruncation &&
      order.length !== config.options.length
    ) {
      throw new InvalidBallotError(
        'PAYLOAD_KIND_NOT_ACCEPTED',
        'el método no permite rankings truncados: deben aparecer todas las opciones',
      );
    }
  }

  if (ballot.payload.kind === 'grades') {
    if (config.method.kind !== 'majority-judgment') {
      throw new InvalidBallotError(
        'PAYLOAD_KIND_NOT_ACCEPTED',
        'menciones en un método incompatible',
      );
    }
    const entries = ballot.payload.grades;
    const options = optionsOf(entries);
    if (options === undefined) {
      throw new InvalidBallotError(
        'PAYLOAD_KIND_NOT_ACCEPTED',
        'la papeleta de menciones repite la misma opción más de una vez',
      );
    }
    for (const option of options) {
      if (!config.options.includes(option)) {
        throw new InvalidBallotError(
          'PAYLOAD_KIND_NOT_ACCEPTED',
          'la papeleta de menciones contiene una opción ajena a la decisión',
        );
      }
    }
    if (
      config.method.missingGradePolicy === 'reject-ballot' &&
      !sameOptionSet(options, config.options)
    ) {
      throw new InvalidBallotError(
        'PAYLOAD_KIND_NOT_ACCEPTED',
        'majority-judgment exige una mención para cada opción (B.7.b)',
      );
    }
    const gradeIds = new Set(config.method.scale.grades.map((grade) => grade.id));
    for (const entry of entries) {
      if (!gradeIds.has(entry.grade)) {
        throw new InvalidBallotError(
          'PAYLOAD_KIND_NOT_ACCEPTED',
          'la papeleta contiene una mención que no pertenece a la escala congelada',
        );
      }
    }
  }
}

/** Variante no excepcional, para filtrar en el escrutinio sin construir errores. */
export function isBallotValid(
  config: DecisionConfig,
  ballot: Ballot,
  context: BallotContext,
): boolean {
  try {
    validateBallot(config, ballot, context);
    return true;
  } catch (error) {
    if (error instanceof InvalidBallotError) return false;
    throw error;
  }
}

/** Motivo del rechazo, o `undefined` si la papeleta es válida. Útil para explicar en la interfaz. */
export function ballotRejection(
  config: DecisionConfig,
  ballot: Ballot,
  context: BallotContext,
): string | undefined {
  try {
    validateBallot(config, ballot, context);
    return undefined;
  } catch (error) {
    if (error instanceof InvalidBallotError) return error.rejection;
    throw error;
  }
}

/** ¿Este votante figura en el padrón congelado? Atajo legible para la capa de aplicación. */
export function isVoterEligible(electorate: Electorate, voter: MemberId): boolean {
  return isEligible(electorate, voter);
}
