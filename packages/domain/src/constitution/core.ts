/**
 * El núcleo intangible, la aritmética de los umbrales y el calendario de las ventanas.
 *
 * ═══ El núcleo NO se protege con tipos ═══
 *
 * Se podría declarar el núcleo como una unión literal de seis identificadores y dormir tranquilo.
 * Sería falso: los tipos de TypeScript **se borran al compilar**. Quien trae un historial de fuera
 * —el administrador técnico del §7, que hace copias y restaura— no pasa por el compilador; pasa por
 * el pliegue. Un `type Nucleo = 'lista_taxativa' | …` no rechaza un solo evento en tiempo de
 * ejecución.
 *
 * Así que el núcleo se protege con un **hecho**: es un conjunto de `(clauseId, textHash)` fijado en
 * el evento fundacional, y el pliegue lo recomputa desde el texto vigente en cada evento y lo
 * compara con el del génesis (`assertCoreIntact`). Cambiar una coma del texto de una cláusula del
 * núcleo cambia su hash, y el historial deja de plegarse. Quitarla, también. La comparación es sobre
 * la **preimagen canónica** completa (`canonicalEquals`), no campo a campo: un campo que alguien
 * añada mañana a `Clause` queda cubierto sin que nadie tenga que acordarse de compararlo, que es
 * exactamente el fallo que una comparación escrita a mano acaba teniendo.
 *
 * ═══ Qué NO puede este módulo ═══
 *
 * No puede impedir que quien reescriba el **génesis entero** —los seis hashes incluidos— produzca un
 * historial coherente consigo mismo: el pliegue compara contra el génesis, y si el génesis miente,
 * miente el patrón de comparación. Para eso está `constitutionCoreHash`, que produce el hash
 * publicable del núcleo, y `verifyConstitutionLog(log, { expectedCoreHash })`, que lo coteja contra
 * un valor que vive **fuera** del historial: publicado, anclado con quórum 2-de-3 y por tanto
 * imposible de cambiar sin dejar rastro fuera del alcance de quien administra. La protección del
 * núcleo es, en dos capas: el pliegue contra el génesis, y el anclaje externo contra el génesis
 * falsificado.
 *
 * ═══ Aritmética ═══
 *
 * ADR-0027: prohibido el punto flotante en un umbral. «2/3 sobre el censo» es
 * `favor × 3 ≥ 2 × censo`, con `bigint`, y con 300 personas da 200 exactas. Con `Number` daría
 * `199.99999999999997` y una reforma que se aprobó por los pelos se rechazaría —o al revés—.
 */

import { canonicalBytes, hashCanonical } from '../canonical.js';
import { DomainError, PreconditionError } from '../errors.js';
import { cmpFraction, type Fraction, fraction, isProperFraction, HALF } from '../fraction.js';
import { type Hash, type Instant, instant } from '../ids.js';
import { bogotaCivilToInstant, daysFromCivil, instantToBogotaCivil } from '../window.js';
import {
  type Clause,
  type ClauseId,
  clauseId as toClauseId,
  type ConstitutionText,
  type ConvenedDecision,
  isWellFormedClause,
  type ReformCalendar,
  type ReformRequirements,
} from './types.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El error que cierra el agregado
// ═════════════════════════════════════════════════════════════════════════════════════════════

export type CoreViolation =
  /** El núcleo declarado no tiene exactamente las seis cláusulas del §6.b. */
  | 'CORE_INCOMPLETE'
  /** Una cláusula del núcleo no está en el texto. */
  | 'CORE_CLAUSE_MISSING'
  /** Una cláusula del núcleo está, pero con otro texto. */
  | 'CORE_CLAUSE_ALTERED'
  /** El evento declara un núcleo distinto del que fijó el génesis. */
  | 'CORE_SET_ALTERED';

/**
 * El núcleo intangible fue alterado. **No hay procedimiento que lo permita** (§6.b).
 *
 * Cambiar uno de esos seis puntos no es reformar: es fundar otra cosa, y el único camino honesto es
 * refundar en público con la historia exportada y entregada —lo que en términos de este agregado
 * significa **otro historial**, no un evento más en éste—.
 */
export class CoreAlteredError extends DomainError {
  readonly violation: CoreViolation;
  readonly clauseId: ClauseId | undefined;

  constructor(violation: CoreViolation, detail: string, clause?: ClauseId) {
    super(
      violation,
      `núcleo intangible alterado (${violation}): ${detail}. Los seis puntos del §6.b no se ` +
        'reforman por ningún procedimiento: cambiarlos exige refundar en público',
    );
    this.name = 'CoreAlteredError';
    this.violation = violation;
    this.clauseId = clause;
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Los seis puntos del núcleo intangible (§6.b)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Los seis puntos, en el orden en que los enumera `GOVERNANCE.md` §6.b, como etiquetas.
 *
 * Los **identificadores** viven aquí porque son estructura del documento y no cambian sin cambiar el
 * documento; los **textos** viven fuera y entran por su hash. Exigir estos seis exactos impide la
 * fundación mutilada: un génesis al que le falte «la lista taxativa» no se pliega, y esa es la forma
 * más barata de vaciar el núcleo —no alterarlo, sino no incluirlo—.
 */
export const CORE_CLAUSE_IDS: readonly ClauseId[] = [
  /** (i) el derecho de todo miembro a deliberar, objetar y votar. */
  toClauseId('derecho_de_voz_y_voto'),
  /** (ii) la publicidad y la verificabilidad independiente del registro. */
  toClauseId('publicidad_del_registro'),
  /** (iii) la prohibición de que el poder político sea transferible o comprable. */
  toClauseId('poder_no_transferible'),
  /** (iv) la caducidad de los acuerdos y de este núcleo. */
  toClauseId('caducidad_de_los_acuerdos'),
  /** (v) el derecho a exportar la historia completa. */
  toClauseId('derecho_a_exportar'),
  /** (vi) la lista taxativa de la fila 20. */
  toClauseId('lista_taxativa'),
];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Igualdad canónica
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ¿Dos valores del dominio son **el mismo hecho**? Se comparan sus preimágenes canónicas.
 *
 * Es la definición de igualdad que ya usa todo el sistema para hashear (ADR-0004), aplicada sin
 * hashear: si `jcs(a) === jcs(b)`, entonces `sha256(jcs(a)) === sha256(jcs(b))`, y al revés salvo
 * colisión. Comparar la preimagen en vez del hash tiene dos ventajas aquí: es **síncrono** —el
 * pliegue no puede esperar a WebCrypto— y no tiene colisiones que discutir.
 */
export function canonicalEquals(a: unknown, b: unknown): boolean {
  const left = canonicalBytes(a);
  const right = canonicalBytes(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

/**
 * El hash publicable del núcleo. **Fuera del pliegue**, porque hashear es asíncrono (WebCrypto).
 *
 * Éste es el valor que se publica, se ancla y se compara contra el historial en
 * `verifyConstitutionLog`. Es lo único que detecta un génesis reescrito de arriba abajo.
 */
export async function constitutionCoreHash(core: readonly Clause[]): Promise<Hash> {
  return hashCanonical({ core: [...core] });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Comprobaciones del núcleo
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** El núcleo declarado en el génesis: los seis, en orden, bien formados y sin repetir. */
export function assertWellFormedCore(core: readonly Clause[]): void {
  if (core.length !== CORE_CLAUSE_IDS.length) {
    throw new CoreAlteredError(
      'CORE_INCOMPLETE',
      `el núcleo tiene ${String(CORE_CLAUSE_IDS.length)} puntos y se declararon ` +
        String(core.length),
    );
  }
  for (let i = 0; i < core.length; i++) {
    const clause = core[i];
    const expected = CORE_CLAUSE_IDS[i];
    if (clause === undefined || expected === undefined) {
      throw new CoreAlteredError('CORE_INCOMPLETE', 'hueco en el arreglo del núcleo');
    }
    if (clause.clauseId !== expected) {
      throw new CoreAlteredError(
        'CORE_INCOMPLETE',
        `en la posición ${String(i)} se esperaba ${expected} y llegó ${clause.clauseId}; el ` +
          'núcleo se declara completo y en el orden del §6.b',
        clause.clauseId,
      );
    }
    if (!isWellFormedClause(clause)) {
      throw new CoreAlteredError(
        'CORE_INCOMPLETE',
        `la cláusula ${clause.clauseId} no declara un hash de texto bien formado`,
        clause.clauseId,
      );
    }
  }
}

/**
 * Recomputa el núcleo **desde el texto**: para cada punto del núcleo, la cláusula que el texto
 * vigente tiene con ese identificador.
 *
 * Si falta, lanza. Un texto que no contiene el núcleo no es una constitución de esta comunidad.
 */
export function coreProjection(text: ConstitutionText, core: readonly Clause[]): readonly Clause[] {
  const index = new Map<ClauseId, Clause>(text.clauses.map((c) => [c.clauseId, c]));
  return core.map((expected) => {
    const found = index.get(expected.clauseId);
    if (found === undefined) {
      throw new CoreAlteredError(
        'CORE_CLAUSE_MISSING',
        `el texto no contiene ${expected.clauseId}; vaciar el núcleo quitándolo del texto es la ` +
          'forma más barata de derogarlo, y por eso se comprueba en cada evento',
        expected.clauseId,
      );
    }
    return found;
  });
}

/**
 * **La comprobación que sostiene el agregado.** Recomputa el núcleo desde `text` y lo compara con el
 * fijado en el génesis. Se llama al final de **cada** evento plegado, sin excepción.
 *
 * No se llama sólo desde las órdenes a propósito. La orden es una puerta; el pliegue es por donde
 * pasa **todo** historial —el de esta API, el de una restauración y el del fichero que alguien
 * trajo—. Una regla que sólo estuviera en la orden se saltaría escribiendo el evento por otro
 * camino, y el historial resultante se plegaría tan tranquilo.
 */
export function assertCoreIntact(core: readonly Clause[], text: ConstitutionText): void {
  if (core.length === 0) return;
  const recomputed = coreProjection(text, core);
  if (canonicalEquals(core, recomputed)) return;
  for (let i = 0; i < core.length; i++) {
    const expected = core[i];
    const actual = recomputed[i];
    if (expected === undefined || actual === undefined) continue;
    if (expected.textHash !== actual.textHash) {
      throw new CoreAlteredError(
        'CORE_CLAUSE_ALTERED',
        `${expected.clauseId} cambió de texto: el génesis fijó ${expected.textHash} y el texto ` +
          `vigente trae ${actual.textHash}`,
        expected.clauseId,
      );
    }
  }
  throw new CoreAlteredError(
    'CORE_CLAUSE_ALTERED',
    'el núcleo recomputado desde el texto vigente no coincide con el del evento fundacional',
  );
}

/** El núcleo que declara un evento tiene que ser **idéntico** al del génesis. */
export function assertSameCore(genesis: readonly Clause[], declared: readonly Clause[]): void {
  if (canonicalEquals(genesis, declared)) return;
  throw new CoreAlteredError(
    'CORE_SET_ALTERED',
    'este evento declara un núcleo distinto del que fijó el evento fundacional. Ni una ' +
      'refundación lo cambia: refundar con otro núcleo es empezar otra comunidad, con otro ' +
      'historial, no escribir un evento más en éste',
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Aritmética exacta de umbrales (ADR-0027)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Un conteo del dominio: entero seguro, no negativo. */
export function assertCount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PreconditionError(
      'INVALID_COUNT',
      `${field} tiene que ser un entero seguro no negativo y llegó ${String(value)}`,
    );
  }
}

/**
 * `count / base ≥ share`, sin punto flotante. Multiplicación cruzada con `bigint`.
 *
 * Con `share = 2/3` y `base = 300`: `count × 3 ≥ 2 × 300`, que es `count ≥ 200` **exacto**.
 */
export function meetsShareOf(count: number, share: Fraction, base: number): boolean {
  return BigInt(count) * share.den >= share.num * BigInt(base);
}

/**
 * El conteo mínimo que satisface la fracción: `⌈num × base / den⌉`. Para mensajes y para la
 * interfaz —«faltan 3 votos»—, nunca para decidir: decidir es `meetsShareOf`.
 */
export function requiredCount(share: Fraction, base: number): number {
  const numerator = share.num * BigInt(base);
  return Number((numerator + share.den - 1n) / share.den);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Calendario. Aritmética entera pura: ni `Date`, ni `Intl`, ni reloj (ADR-0001).
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const DAY_MS = 86_400_000;

export function addDays(at: Instant, days: number): Instant {
  return instant(at + days * DAY_MS);
}

/** Días del mes civil, por diferencia de días desde el epoch. Sin tablas y sin años bisiestos a mano. */
export function daysInMonth(year: number, month: number): number {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return daysFromCivil(nextYear, nextMonth, 1) - daysFromCivil(year, month, 1);
}

/**
 * Suma meses **civiles** en hora de Bogotá, con el día recortado al último del mes destino.
 *
 * Se suman meses y no milisegundos porque «doce meses» y «un semestre» son unidades del calendario
 * de la asamblea, no duraciones: una caducidad a los `365 × 86 400 000` ms vencería el 31 de agosto
 * si se fundó el 1 de septiembre de un año bisiesto, y habría que explicarlo. El recorte
 * —31 de enero + 1 mes = 28 de febrero— es la convención habitual y se declara porque la otra
 * —desbordar al 3 de marzo— también es defendible y produce fechas distintas.
 */
export function addMonths(at: Instant, months: number): Instant {
  const civil = instantToBogotaCivil(at);
  const total = civil.year * 12 + (civil.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  const day = Math.min(civil.day, daysInMonth(year, month));
  return bogotaCivilToInstant({ ...civil, year, month, day });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Ventana propia (§6.c): «no se cambian las reglas viendo el marcador»
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Días de veda antes de una decisión ya convocada a la que la reforma afectaría (§6.c). */
export const OWN_WINDOW_DAYS = 30;
/** Las dos últimas semanas del semestre son veda para toda reforma, afecte a lo que afecte (§6.c). */
export const SEMESTER_TAIL_DAYS = 14;

/** Intervalo semiabierto `[from, to)`, como toda ventana del sistema (D.3.b). */
export interface Blackout {
  readonly from: Instant;
  readonly to: Instant;
  readonly reason: string;
}

/**
 * Las vedas que aplican a una reforma que toca `changed`.
 *
 * El calendario está **congelado** en el evento que abrió la reforma: si se leyera el calendario
 * vivo, bastaría con desconvocar una decisión para abrir la veda, que es la misma trampa que la
 * copia congelada cierra en los umbrales.
 */
export function blackoutsFor(
  calendar: ReformCalendar,
  changed: readonly ClauseId[],
): readonly Blackout[] {
  const touched = new Set<ClauseId>(changed);
  const out: Blackout[] = [
    {
      from: addDays(calendar.semesterEndsAt, -SEMESTER_TAIL_DAYS),
      to: calendar.semesterEndsAt,
      reason: 'las dos últimas semanas del semestre son veda para toda reforma (§6.c)',
    },
  ];
  for (const decision of calendar.convened) {
    if (!decision.affectsClauseIds.some((id) => touched.has(id))) continue;
    out.push({
      from: addDays(decision.opensAt, -OWN_WINDOW_DAYS),
      to: decision.opensAt,
      reason:
        `la decisión ${decision.decisionId} ya estaba convocada y depende de una cláusula que ` +
        'esta reforma cambia: no se vota la regla en los 30 días anteriores (§6.c)',
    });
  }
  return out;
}

/** ¿Se solapan dos intervalos semiabiertos? */
function overlaps(aFrom: Instant, aTo: Instant, bFrom: Instant, bTo: Instant): boolean {
  return aFrom < bTo && bFrom < aTo;
}

/**
 * La votación de la reforma no puede caer en una veda. Lanza `REFORM_IN_ITS_OWN_WINDOW`.
 *
 * **Lo que esto NO hace:** comprobar que el calendario congelado sea completo y verdadero. Una
 * reforma que declare una lista vacía de decisiones convocadas pasa esta comprobación. El calendario
 * es un hecho público del ledger —las decisiones convocadas están ahí— y verificarlo es
 * precisamente lo que el §6.6 le encarga a Garantías al aprobar el procedimiento. Como el resto de
 * este agregado: detección, no prevención.
 */
export function assertOutsideOwnWindow(
  voteOpensAt: Instant,
  voteClosesAt: Instant,
  calendar: ReformCalendar,
  changed: readonly ClauseId[],
): void {
  for (const blackout of blackoutsFor(calendar, changed)) {
    if (overlaps(voteOpensAt, voteClosesAt, blackout.from, blackout.to)) {
      throw new PreconditionError('REFORM_IN_ITS_OWN_WINDOW', blackout.reason);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Forma del texto
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Vigencia mínima de una versión. Menos de un mes no es una constitución: es un borrador. */
export const MIN_VALIDITY_MONTHS = 1;
/**
 * Vigencia máxima. §10 fija «revisión ordinaria cada dos años, con una intermedia al año», así que
 * veinticuatro meses es el techo que el propio documento se pone.
 *
 * El techo **no es cosmético**: la caducidad de los acuerdos y de este núcleo es el punto (iv) del
 * núcleo intangible. Una reforma que pusiera `validityMonths` en 1200 no estaría alargando un plazo,
 * estaría derogando el punto (iv) sin tocar su texto.
 */
export const MAX_VALIDITY_MONTHS = 24;
/** §6: la versión fundacional vence a los doce meses. */
export const FOUNDATIONAL_VALIDITY_MONTHS = 12;

/** §6, «el problema del arranque»: 2/3 **de las papeletas**, no del censo. */
export const FOUNDING_APPROVAL_OF_BALLOTS: Fraction = fraction(2n, 3n);
/** §6: participación mínima de 100 sobre 300. Las cifras absolutas se recalculan; la fracción no. */
export const FOUNDING_MIN_PARTICIPATION: Fraction = fraction(1n, 3n);

function assertProper(value: Fraction, field: string): void {
  if (!isProperFraction(value)) {
    throw new PreconditionError(
      'FRACTION_OUT_OF_RANGE',
      `${field} tiene que ser una fracción de [0, 1]`,
    );
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PreconditionError(
      'INVALID_REQUIREMENT',
      `${field} tiene que ser un entero seguro mayor que cero y llegó ${String(value)}`,
    );
  }
}

/**
 * Los requisitos de una vía, bien formados.
 *
 * El piso de supermayoría es la única cota que este módulo le pone al contenido de una reforma, y no
 * es un capricho: sin él, **una** reforma atrincherada podría dejar todas las futuras en mayoría
 * simple sobre el censo, que es la puerta de atrás que este agregado existe para cerrar —la misma
 * que se rechaza en la caducidad: degradar el quórum nunca es la respuesta—. `> 1/2` es la cota más
 * débil posible que todavía significa «supermayoría».
 */
export function assertWellFormedRequirements(
  requirements: ReformRequirements,
  field: string,
): void {
  assertProper(requirements.approvalOfCensus, `${field}.approvalOfCensus`);
  assertProper(requirements.minDirectParticipation, `${field}.minDirectParticipation`);
  assertProper(requirements.sponsorSignatures, `${field}.sponsorSignatures`);
  if (cmpFraction(requirements.approvalOfCensus, HALF) <= 0) {
    throw new PreconditionError(
      'THRESHOLD_BELOW_SUPERMAJORITY',
      `${field}.approvalOfCensus tiene que ser mayor que 1/2: una reforma que se aprueba con la ` +
        'mitad del censo no reforma la cláusula de enmienda, la deroga',
    );
  }
  assertPositiveInteger(requirements.deliberationDays, `${field}.deliberationDays`);
  assertPositiveInteger(requirements.waitingDays, `${field}.waitingDays`);
  assertPositiveInteger(requirements.guaranteeThreshold, `${field}.guaranteeThreshold`);
  assertPositiveInteger(requirements.guaranteeCircleSize, `${field}.guaranteeCircleSize`);
  assertPositiveInteger(requirements.votesRequired, `${field}.votesRequired`);
  assertCount(requirements.separationMonths, `${field}.separationMonths`);
  if (requirements.guaranteeThreshold > requirements.guaranteeCircleSize) {
    throw new PreconditionError(
      'INVALID_REQUIREMENT',
      `${field}: se exigen ${String(requirements.guaranteeThreshold)} firmas de un círculo de ` +
        `${String(requirements.guaranteeCircleSize)}: un umbral inalcanzable es una reforma ` +
        'imposible disfrazada de reforma difícil',
    );
  }
  if (requirements.votesRequired > 1 && requirements.separationMonths < 1) {
    throw new PreconditionError(
      'INVALID_REQUIREMENT',
      `${field}: dos votaciones sin separación son una votación repetida el mismo día; la doble ` +
        'llave temporal exige que el cuerpo que vota la segunda vez no sea el mismo (§6.a)',
    );
  }
}

/**
 * La vía atrincherada no puede ser **más fácil** que la ordinaria en ninguna dimensión.
 *
 * Es la comprobación estructural de «hacia arriba» del §10. Sin ella, una reforma ordinaria podría
 * dejar la fila 14 más blanda que la 13 y a partir de ahí reformar la sección 10 por la vía barata.
 */
export function assertEntrenchedNotWeaker(text: ConstitutionText): void {
  const { ordinary, entrenched } = text;
  const stricter: readonly [string, boolean][] = [
    ['approvalOfCensus', cmpFraction(entrenched.approvalOfCensus, ordinary.approvalOfCensus) >= 0],
    [
      'minDirectParticipation',
      cmpFraction(entrenched.minDirectParticipation, ordinary.minDirectParticipation) >= 0,
    ],
    [
      'sponsorSignatures',
      cmpFraction(entrenched.sponsorSignatures, ordinary.sponsorSignatures) >= 0,
    ],
    ['deliberationDays', entrenched.deliberationDays >= ordinary.deliberationDays],
    ['waitingDays', entrenched.waitingDays >= ordinary.waitingDays],
    ['guaranteeThreshold', entrenched.guaranteeThreshold >= ordinary.guaranteeThreshold],
    ['votesRequired', entrenched.votesRequired >= ordinary.votesRequired],
    ['separationMonths', entrenched.separationMonths >= ordinary.separationMonths],
  ];
  for (const [field, ok] of stricter) {
    if (ok) continue;
    throw new PreconditionError(
      'ENTRENCHED_WEAKER_THAN_ORDINARY',
      `la vía atrincherada exige menos que la ordinaria en ${field}: si reformar la cláusula de ` +
        'enmienda fuera más barato que reformar una regla cualquiera, el atrincheramiento sería ' +
        'un rodeo en vez de un freno (§10)',
    );
  }
  if (entrenched.guaranteeCircleSize !== ordinary.guaranteeCircleSize) {
    throw new PreconditionError(
      'ENTRENCHED_WEAKER_THAN_ORDINARY',
      'hay un solo Círculo de Garantías (§3): las dos vías cuentan sobre el mismo número de ' +
        'personas o una de las dos está contando sobre un círculo que no existe',
    );
  }
}

/** El texto completo, bien formado: cláusulas ordenadas y sin repetir, requisitos y vigencia. */
export function assertWellFormedText(text: ConstitutionText): void {
  if (text.clauses.length === 0) {
    throw new PreconditionError('EMPTY_TEXT', 'una constitución sin cláusulas no es un texto');
  }
  let previous: ClauseId | undefined;
  for (const clause of text.clauses) {
    if (!isWellFormedClause(clause)) {
      throw new PreconditionError(
        'INVALID_CLAUSE',
        `la cláusula ${clause.clauseId} no está bien formada: etiqueta [a-z][a-z0-9_]{0,31} y ` +
          'hash de 64 hexadecimales en minúscula',
      );
    }
    if (previous !== undefined && previous >= clause.clauseId) {
      throw new PreconditionError(
        'CLAUSES_NOT_SORTED',
        'las cláusulas van estrictamente ordenadas por identificador: sin orden fijo, dos ' +
          'servidores honestos hashean el mismo texto de dos formas (A.1.1.1)',
      );
    }
    previous = clause.clauseId;
  }
  assertWellFormedRequirements(text.ordinary, 'ordinary');
  assertWellFormedRequirements(text.entrenched, 'entrenched');
  assertEntrenchedNotWeaker(text);
  if (
    !Number.isSafeInteger(text.validityMonths) ||
    text.validityMonths < MIN_VALIDITY_MONTHS ||
    text.validityMonths > MAX_VALIDITY_MONTHS
  ) {
    throw new PreconditionError(
      'INVALID_VALIDITY',
      `la vigencia va de ${String(MIN_VALIDITY_MONTHS)} a ${String(MAX_VALIDITY_MONTHS)} meses ` +
        `y llegó ${String(text.validityMonths)}: §10 obliga a revisar cada dos años, y la ` +
        'caducidad de los acuerdos es el punto (iv) del núcleo',
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Diferencias entre versiones (§6.5: «con versión, fecha y diferencia respecto de la anterior»)
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface TextDiff {
  readonly added: readonly ClauseId[];
  readonly removed: readonly ClauseId[];
  readonly changed: readonly ClauseId[];
  /** ¿Cambia la cláusula de enmienda —los requisitos o la vigencia—? Exige la vía atrincherada. */
  readonly touchesAmendmentRule: boolean;
}

/** La diferencia entre dos textos, para publicarla y para decidir qué vía exige la reforma. */
export function diffTexts(previous: ConstitutionText, next: ConstitutionText): TextDiff {
  const before = new Map<ClauseId, Hash>(previous.clauses.map((c) => [c.clauseId, c.textHash]));
  const after = new Map<ClauseId, Hash>(next.clauses.map((c) => [c.clauseId, c.textHash]));
  const added: ClauseId[] = [];
  const removed: ClauseId[] = [];
  const changed: ClauseId[] = [];
  for (const [id, hash] of after) {
    const old = before.get(id);
    if (old === undefined) added.push(id);
    else if (old !== hash) changed.push(id);
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removed.push(id);
  }
  return {
    added,
    removed,
    changed,
    touchesAmendmentRule:
      !canonicalEquals(previous.ordinary, next.ordinary) ||
      !canonicalEquals(previous.entrenched, next.entrenched) ||
      previous.validityMonths !== next.validityMonths,
  };
}

/** Los identificadores que la reforma toca, en cualquier sentido. Base de la veda del §6.c. */
export function changedClauseIds(previous: ConstitutionText, next: ConstitutionText): ClauseId[] {
  const diff = diffTexts(previous, next);
  return [...diff.added, ...diff.removed, ...diff.changed];
}

/** ¿La reforma es puramente formal —no cambia nada—? Una re-ratificación lo es, y es legítima. */
export function isNoOpReform(previous: ConstitutionText, next: ConstitutionText): boolean {
  return canonicalEquals(previous, next);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Los números de `GOVERNANCE.md`, como dato de arranque
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Fila 13: 2/3 sobre el censo, 100 en voto directo, 21 días de deliberación, 14 de espera, 3 de 5
 * de Garantías, 30 firmas (10 %).
 *
 * Es una **propuesta de génesis**, no la regla: la regla es la que quede en el ledger el día que la
 * asamblea funde la constitución. Vive aquí para que quien arme ese génesis no tenga que
 * transcribir la tabla a mano, y para que los tests midan contra los números del documento.
 */
export const ORDINARY_REFORM_V1: ReformRequirements = {
  approvalOfCensus: fraction(2n, 3n),
  minDirectParticipation: fraction(1n, 3n),
  deliberationDays: 21,
  waitingDays: 14,
  guaranteeThreshold: 3,
  guaranteeCircleSize: 5,
  votesRequired: 1,
  separationMonths: 0,
  sponsorSignatures: fraction(1n, 10n),
};

/**
 * Fila 14: 3/4 sobre el censo en **dos** votaciones separadas por un semestre, 150 en voto directo
 * en ambas, 4 de 5 de Garantías, 60 firmas (20 %).
 *
 * Los días de deliberación y de espera **no los da la fila 14**. Se toman los de la fila 13 como
 * piso, porque reformar la cláusula de enmienda no puede ser más barato que reformar una regla
 * cualquiera en ninguna dimensión (§10, «hacia arriba»). Queda declarado como hueco del documento.
 */
export const ENTRENCHED_REFORM_V1: ReformRequirements = {
  approvalOfCensus: fraction(3n, 4n),
  minDirectParticipation: fraction(1n, 2n),
  deliberationDays: 21,
  waitingDays: 14,
  guaranteeThreshold: 4,
  guaranteeCircleSize: 5,
  votesRequired: 2,
  separationMonths: 6,
  sponsorSignatures: fraction(1n, 5n),
};

/** Una decisión convocada, para armar un calendario sin repetir la forma. */
export function convenedDecision(
  decision: ConvenedDecision['decisionId'],
  opensAt: Instant,
  affectsClauseIds: readonly ClauseId[],
): ConvenedDecision {
  return { decisionId: decision, opensAt, affectsClauseIds };
}
