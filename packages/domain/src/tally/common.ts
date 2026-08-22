/**
 * Marco común del escrutinio (B.0) y el `DecisionResult` con su demostración (A.6).
 *
 * ═══ Papeletas efectivas (B.0.1) ═══
 *
 * Antes de aplicar cualquier método, el escrutinio produce el conjunto de papeletas efectivas: una
 * por votante, la de mayor `seq` (A.5), filtradas por validez, y con su peso resuelto.
 *
 * El filtro no es defensa redundante: `castBallot` ya rechaza la papeleta inválida y ésta nunca entra
 * al log. Pero INV-01 exige que **un voto inválido nunca cambie el resultado**, y la única forma de
 * que eso sea cierto también frente a un log manipulado a mano es que el escrutinio vuelva a filtrar.
 * Un motor que confía en que aguas arriba ya validaron es un motor que publica el resultado de una
 * urna adulterada.
 *
 * ═══ El resultado viene con su demostración ═══
 *
 * Principio 0.1.2: todo `DecisionResult` viaja con una `Proof`: una secuencia de pasos que un
 * estudiante de filosofía puede leer y verificar a mano con la tabla de papeletas. Si un método no
 * puede producir una prueba legible, no entra en la plataforma.
 *
 * ═══ Aritmética exacta (B.0.4) ═══
 *
 * Todos los umbrales se comparan con `bigint` por multiplicación cruzada. `A / D >= 2/3` en punto
 * flotante rechaza `200/300`, que cumple exactamente el umbral (INV-18).
 *
 * DECISIÓN B.0.d: `den === 0` ⇒ **no aprueba**. «Cero de cero» no es unanimidad, es ausencia de
 * decisión. Es la trampa clásica de los motores de consenso (`0/0 = NaN`, o peor, `true` por
 * vacuidad). INV-52.
 */

import { concatBytes, sha256, toHex } from '@koinonia/crypto';

import { type Ballot, type BallotContext, type BallotPayload, isBallotValid } from '../ballot.js';
import { hashCanonical, type JsonObject } from '../canonical.js';
import type { AbstentionPolicy, DecisionConfig, ThresholdBase } from '../config.js';
import { InvalidBallotForMethod, PreconditionError } from '../errors.js';
import { cmpFraction, type Fraction, normalize, ratio, toFractionString } from '../fraction.js';
import {
  type BallotId,
  compareIds,
  type DecisionId,
  type Hash,
  type Instant,
  type MemberId,
  type OptionId,
  sortIds,
} from '../ids.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Papeletas efectivas y pesos
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface EffectiveBallot {
  /** Emisor real de la papeleta. */
  readonly voter: MemberId;
  readonly payload: BallotPayload;
  /** Entero ≥ 1 (DECISIÓN B.0.a: los pesos son enteros; «Marta votó por 7 personas»). */
  readonly weight: number;
  /** `seq` del evento, para desempates estables. */
  readonly seq: number;
  /** Delegantes representados, ordenado. Vacío mientras la PARTE C no esté implementada. */
  readonly onBehalfOf: readonly MemberId[];
}

/**
 * Punto de extensión de la democracia líquida (PARTE C).
 *
 * DECISIÓN A.4: el peso **no** se congela al emitir la papeleta; se resuelve en el escrutinio, con
 * el grafo de delegaciones vigente en el instante de cierre. Por eso el resolutor recibe `closedAt`:
 * cuando la PARTE C entre, la revocación de una delegación un milisegundo antes del cierre tendrá el
 * efecto exacto que promete la interfaz, sin tocar una línea del escrutinio.
 */
export type WeightResolver = (
  config: DecisionConfig,
  ballots: readonly Ballot[],
  closedAt: Instant,
) => readonly EffectiveBallot[];

/** Resolutor sin delegación: una persona, un voto. Es el vigente en esta entrega. */
export const directWeightResolver: WeightResolver = (_config, ballots, _closedAt) =>
  ballots.map((ballot) => ({
    voter: ballot.voter,
    payload: ballot.payload,
    weight: 1,
    seq: ballot.seq,
    onBehalfOf: [],
  }));

export interface TallyContext extends BallotContext {
  /** Cierre real de la decisión (tras prórrogas). Es el instante de resolución de pesos. */
  readonly closedAt: Instant;
  /** Papeletas anuladas por `BallotVoided` (A.2). */
  readonly voided: readonly BallotId[];
}

/**
 * INV-07 / INV-08 — una papeleta por votante, la de mayor `seq`.
 *
 * El orden de salida es el del **padrón** (ascendente por `memberId`), no el de llegada: así ninguna
 * etapa posterior puede depender del orden en que entraron los votos, que es exactamente lo que un
 * atacante controla (INV-16, INV-17).
 */
export function lastBallotPerVoter(ballots: readonly Ballot[]): readonly Ballot[] {
  const best = new Map<string, Ballot>();
  for (const ballot of ballots) {
    const current = best.get(ballot.voter);
    if (current === undefined || ballot.seq > current.seq) best.set(ballot.voter, ballot);
  }
  return [...best.values()].sort((a, b) => compareIds(a.voter, b.voter));
}

/** Precondiciones de B.0.1. Si alguna falla, el log está roto y no se publica ningún resultado. */
export function precheck(config: DecisionConfig, ballots: readonly EffectiveBallot[]): void {
  for (const ballot of ballots) {
    if (!Number.isSafeInteger(ballot.weight) || ballot.weight < 1) {
      throw new PreconditionError(
        'NON_INTEGER_WEIGHT',
        `el peso de ${ballot.voter} no es un entero ≥ 1 (B.0.a)`,
      );
    }
  }
  const voters = ballots.map((b) => b.voter);
  for (let i = 1; i < voters.length; i++) {
    const previous = voters[i - 1];
    const current = voters[i];
    if (previous !== undefined && current !== undefined && compareIds(previous, current) !== -1) {
      throw new PreconditionError(
        'DUPLICATE_VOTER',
        'INV-08: un votante no puede aportar dos papeletas efectivas',
      );
    }
  }
  const total = totalWeight(ballots);
  if (total > config.electorate.censusSize) {
    throw new PreconditionError(
      'WEIGHT_EXCEEDS_CENSUS',
      `INV-21: la suma de pesos (${String(total)}) excede el censo ` +
        `(${String(config.electorate.censusSize)})`,
    );
  }
  // INV-22: `{voter} ∪ onBehalfOf` disjuntos dos a dos y contenidos en el padrón.
  const seen = new Set<string>();
  for (const ballot of ballots) {
    for (const member of [ballot.voter, ...ballot.onBehalfOf]) {
      if (seen.has(member)) {
        throw new PreconditionError(
          'MEMBER_COUNTED_TWICE',
          `INV-22: ${member} contribuye a más de una papeleta efectiva`,
        );
      }
      seen.add(member);
    }
  }
}

/**
 * Papeletas efectivas: filtra las inválidas y las anuladas, aplica «la última manda» y resuelve los
 * pesos. Es la única entrada de todos los escrutadores.
 */
export function effectiveBallots(
  config: DecisionConfig,
  ballots: readonly Ballot[],
  context: TallyContext,
  resolver: WeightResolver = directWeightResolver,
): readonly EffectiveBallot[] {
  const voided = new Set<string>(context.voided);
  const usable = ballots.filter(
    (ballot) => !voided.has(ballot.ballotId) && isBallotValid(config, ballot, context),
  );
  const effective = resolver(config, lastBallotPerVoter(usable), context.closedAt);
  precheck(config, effective);
  return effective;
}

/** `E` de la PARTE D: miembros representados, ordenado y sin duplicados (D.1.d). */
export function representedMembers(ballots: readonly EffectiveBallot[]): readonly MemberId[] {
  const all: MemberId[] = [];
  for (const ballot of ballots) {
    all.push(ballot.voter);
    all.push(...ballot.onBehalfOf);
  }
  return sortIds(all);
}

export function totalWeight(ballots: readonly EffectiveBallot[]): number {
  return ballots.reduce((sum, b) => sum + b.weight, 0);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Umbral genérico (B.0.4)
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ThresholdInput {
  /** Peso total a favor. */
  readonly approve: number;
  /** Peso total en contra. */
  readonly reject: number;
  /** Peso total en abstención EXPLÍCITA. El silencio no está aquí: no emitió papeleta. */
  readonly abstain: number;
  /** `N`. */
  readonly census: number;
}

/**
 * Reparte los pesos entre sí / no / abstención.
 *
 * INV-11: la abstención explícita **nunca** suma al numerador. El fallo ingenuo que el invariante
 * describe —modelar la papeleta como `boolean | null` y que el `null` caiga en el `else` del
 * `if (approve)` sumando a los noes— es inexpresable con una unión discriminada.
 */
export function countBinary(
  ballots: readonly EffectiveBallot[],
  methodKind: string,
): { approve: number; reject: number; abstain: number } {
  let approve = 0;
  let reject = 0;
  let abstain = 0;
  for (const ballot of ballots) {
    switch (ballot.payload.kind) {
      case 'abstain':
        abstain += ballot.weight;
        break;
      case 'binary':
        if (ballot.payload.approve) approve += ballot.weight;
        else reject += ballot.weight;
        break;
      default:
        // INV-12: se rechaza, no se convierte. Inalcanzable con un log legal.
        throw new InvalidBallotForMethod(ballot.payload.kind, methodKind);
    }
  }
  return { approve, reject, abstain };
}

/**
 * Denominador del umbral. **Éste es el punto que siempre se malentiende.**
 *
 * Censo `N = 300`, `A = 100`, `R = 60`, `Ab = 40`, silencio `= 100`:
 *
 * | política        | denominador | cociente | ¿aprueba con 1/2 estricto? |
 * |-----------------|-------------|----------|----------------------------|
 * | `exclude`       | 160         | 62.50 %  | **sí**                     |
 * | `include`       | 200         | 50.00 %  | no                         |
 * | `as-no`         | 200         | 50.00 %  | no                         |
 * | `base:'census'` | 300         | 33.33 %  | no                         |
 *
 * Cuatro respuestas distintas para la misma urna. Por eso `abstentionPolicy` y `base` son campos
 * obligatorios sin valor por defecto (B.1.a) y la `Proof` dice en castellano cuál se usó.
 *
 * El **silencio** —no emitir papeleta— jamás entra en el denominador del umbral; sólo cuenta para el
 * quórum (PARTE D). Confundir «no votó» con «votó en contra» es cambiar el resultado sin votos.
 */
export function thresholdDenominator(
  input: ThresholdInput,
  policy: AbstentionPolicy,
  base: ThresholdBase,
): bigint {
  if (base === 'census') return BigInt(input.census);
  switch (policy) {
    case 'exclude':
      return BigInt(input.approve + input.reject);
    case 'include':
    case 'as-no':
      return BigInt(input.approve + input.reject + input.abstain);
  }
}

export function passesThreshold(
  input: ThresholdInput,
  required: Fraction,
  strict: boolean,
  policy: AbstentionPolicy,
  base: ThresholdBase,
): boolean {
  const den = thresholdDenominator(input, policy, base);
  if (den === 0n) return false; // B.0.d / INV-52: cero de cero no aprueba.
  const comparison = cmpFraction({ num: BigInt(input.approve), den }, required);
  return strict ? comparison > 0 : comparison >= 0;
}

/** Frase en castellano que describe el denominador elegido. Va en la demostración. */
export function abstentionNarrative(policy: AbstentionPolicy, base: ThresholdBase): string {
  if (base === 'census') {
    return 'El umbral se mide sobre el censo completo: quien no vota pesa como un voto en contra.';
  }
  switch (policy) {
    case 'exclude':
      return (
        'Las abstenciones no cuentan para este cálculo, pero sí cuentan para la participación ' +
        'mínima.'
      );
    case 'include':
      return 'Las abstenciones entran en el denominador: abstenerse equivale a votar «no».';
    case 'as-no':
      return 'Las abstenciones se contaron como votos en contra.';
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Desempate determinista (B.0.2)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * DECISIÓN B.0.b — el desempate final es `hash(decisionId || optionId)`, no el orden alfabético ni
 * el de registro. El alfabético premia sistemáticamente a «Asamblea…» sobre «Zoología…» a lo largo
 * de cientos de decisiones; el de registro premia a quien madruga a radicar. El hash con
 * `decisionId` permuta distinto en cada decisión, es imparcial *a lo largo del tiempo* y cualquiera
 * lo verifica con `sha256sum`.
 *
 * Es un orden total estricto sobre `OptionId` ⇒ la cascada nunca puede fallar (INV-13).
 */
export async function lexicographicHashOrder(
  decision: DecisionId,
  options: readonly OptionId[],
): Promise<readonly OptionId[]> {
  const encoder = new TextEncoder();
  const keyed: { option: OptionId; digest: string }[] = [];
  for (const option of options) {
    const digest = toHex(await sha256(encoder.encode(`${decision}|${option}`)));
    keyed.push({ option, digest });
  }
  return keyed.sort((a, b) => compareIds(a.digest, b.digest)).map((entry) => entry.option);
}

/** HMAC-SHA-256 mínimo sobre las primitivas auditadas del paquete crypto. */
export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const blockSize = 64;
  const encodedKey = encoder.encode(key);
  const shortKey = encodedKey.length > blockSize ? await sha256(encodedKey) : encodedKey;
  const padded = new Uint8Array(blockSize);
  padded.set(shortKey);
  const innerPad = new Uint8Array(blockSize);
  const outerPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    const byte = padded[i] ?? 0;
    innerPad[i] = byte ^ 0x36;
    outerPad[i] = byte ^ 0x5c;
  }
  const inner = await sha256(concatBytes(innerPad, encoder.encode(message)));
  return toHex(await sha256(concatBytes(outerPad, inner)));
}

/** Orden verificable por ticket HMAC; el identificador resuelve la colisión criptográfica. */
export async function hmacOrder<T extends string>(
  seed: string,
  label: string,
  values: readonly T[],
): Promise<readonly { readonly value: T; readonly ticket: string }[]> {
  const ticketed = await Promise.all(
    values.map(async (value) => ({
      value,
      ticket: await hmacSha256Hex(seed, `${label}|${value}`),
    })),
  );
  return ticketed.sort((a, b) => {
    const ticketOrder = compareIds(a.ticket, b.ticket);
    return ticketOrder === 0 ? compareIds(a.value, b.value) : ticketOrder;
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Índices de concentración (C.6, versión mínima)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `HHI = Σ (w_i / W)² = (Σ w_i²) / W²`. Con reparto uniforme vale `1/n`; con un solo votante que lo
 * concentra todo, `1` (INV-31). Sin papeletas se devuelve `0/1`: no hay concentración que medir.
 */
export function herfindahl(weights: readonly number[]): Fraction {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total === 0) return ratio(0, 1);
  let squares = 0n;
  for (const weight of weights) squares += BigInt(weight) * BigInt(weight);
  return normalize({ num: squares, den: BigInt(total) * BigInt(total) });
}

/**
 * `Gini = ΣᵢΣⱼ|wᵢ−wⱼ| / (2·n·Σw)`. Con reparto uniforme vale exactamente 0 (INV-31).
 *
 * Se calcula con la doble suma de diferencias absolutas y no con la fórmula del arreglo ordenado:
 * es `O(n²)` sobre a lo sumo unos cientos de papeletas, y elimina de raíz el fallo ingenuo del
 * invariante (ordenar descendente y obtener un valor negativo).
 */
export function gini(weights: readonly number[]): Fraction {
  const n = weights.length;
  const total = weights.reduce((s, w) => s + w, 0);
  if (n === 0 || total === 0) return ratio(0, 1);
  let sum = 0n;
  for (const a of weights) {
    for (const b of weights) {
      const diff = BigInt(a) - BigInt(b);
      sum += diff < 0n ? -diff : diff;
    }
  }
  return normalize({ num: sum, den: 2n * BigInt(n) * BigInt(total) });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Resultado y demostración (A.6)
// ═════════════════════════════════════════════════════════════════════════════════════════════

export type Outcome =
  | { readonly kind: 'approved'; readonly option?: OptionId }
  | { readonly kind: 'rejected'; readonly reason: 'threshold-not-met' | 'objections-pending' }
  | { readonly kind: 'no-quorum'; readonly achieved: Fraction; readonly required: Fraction }
  | { readonly kind: 'winner'; readonly option: OptionId; readonly tieBroken: boolean }
  | { readonly kind: 'sample'; readonly selected: readonly MemberId[] }
  | { readonly kind: 'needs-new-round'; readonly nextRound: number };

/** Un paso de la demostración. Debe poder renderizarse como una frase en español. */
export interface ProofStep {
  readonly id: string;
  readonly claim: string;
  readonly evidence: Readonly<Record<string, string | number>>;
  /** Referencias a los eventos que sustentan el paso, por `seq`. */
  readonly supportingSeqs: readonly number[];
}

/**
 * DECISIÓN: A.6 escribe el tipo de las filas como `readonly (readonly (string | number))[][]`, que
 * **no compila**: `readonly` sólo modifica tipos de arreglo o tupla, y ahí modifica una unión de
 * primitivos. Se corrige a `readonly (readonly (string | number)[])[]`, que es lo que la estructura
 * quiere decir: una lista de filas, cada fila una lista de celdas. Reportado.
 */
export interface ProofTable {
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
}

export interface Proof {
  readonly steps: readonly ProofStep[];
  readonly tables: readonly ProofTable[];
  /** Narrativa de un párrafo, generada por plantilla determinista y sin jerga. */
  readonly narrative: string;
}

export interface DecisionResult {
  readonly decisionId: DecisionId;
  readonly configHash: Hash;
  readonly rollHash: Hash;
  readonly engineVersion: string;
  /** Último `seq` incluido. Es procedencia, no conclusión: fuera del `resultHash` (ver abajo). */
  readonly computedFromSeq: number;
  readonly outcome: Outcome;
  readonly turnout: {
    /** Papeletas efectivas (`C`). */
    readonly cast: number;
    /**
     * Personas representadas (`|E|`).
     *
     * DECISIÓN: A.6 define `turnout` como `{ cast, census, fraction }` y no dice si `fraction` es
     * `C/N` o `|E|/N`. Sin delegación coinciden; **con** delegación difieren radicalmente, y INV-33
     * advierte precisamente contra confundirlas («12 papeletas con peso 280 darían 4 % de
     * participación»). Se publican las dos magnitudes y `fraction` es `|E|/N`, que es la que manda
     * en el quórum (D.1.1). Reportado como ambigüedad de la especificación.
     */
    readonly represented: number;
    readonly census: number;
    /** `|E| / N`, sin reducir: el par (representados, censo) es lo que se publica. */
    readonly fraction: Fraction;
  };
  readonly weights: {
    readonly totalWeight: number;
    readonly hhi: Fraction;
    readonly gini: Fraction;
  };
  readonly quorumCheck: {
    readonly passed: boolean;
    readonly detail: Readonly<Record<string, boolean>>;
  };
  readonly proof: Proof;
  readonly resultHash: Hash;
}

/** Construye un paso de la demostración. */
export function step(
  id: string,
  claim: string,
  evidence: Readonly<Record<string, string | number>>,
  supportingSeqs: readonly number[] = [],
): ProofStep {
  return { id, claim, evidence, supportingSeqs };
}

function canonicalFraction(f: Fraction): JsonObject {
  return { num: f.num.toString(), den: f.den.toString() };
}

function canonicalOutcome(outcome: Outcome): JsonObject {
  switch (outcome.kind) {
    case 'approved':
      return outcome.option === undefined
        ? { kind: outcome.kind }
        : { kind: outcome.kind, option: outcome.option };
    case 'rejected':
      return { kind: outcome.kind, reason: outcome.reason };
    case 'no-quorum':
      return {
        kind: outcome.kind,
        achieved: canonicalFraction(outcome.achieved),
        required: canonicalFraction(outcome.required),
      };
    case 'winner':
      return { kind: outcome.kind, option: outcome.option, tieBroken: outcome.tieBroken };
    case 'sample':
      return { kind: outcome.kind, selected: [...outcome.selected] };
    case 'needs-new-round':
      return { kind: outcome.kind, nextRound: outcome.nextRound };
  }
}

/**
 * Preimagen del `resultHash`.
 *
 * DECISIÓN: se excluyen **dos** campos, no uno. `resultHash` obviamente (no puede contenerse a sí
 * mismo) y también `computedFromSeq`. A.6 dice «hash del resultado completo salvo este campo», pero
 * INV-01 exige que añadir una papeleta inválida deje intactos `outcome`, `turnout` **y `resultHash`**
 * «salvo `computedFromSeq`». Las dos frases son incompatibles si `computedFromSeq` entra en el hash:
 * una papeleta inválida que llega al log mueve el último `seq` y movería el `resultHash` de un
 * escrutinio idéntico. Se resuelve por donde la especificación misma apunta: `computedFromSeq` es un
 * dato de **procedencia** (hasta dónde se leyó el log), no una conclusión del escrutinio. El anclaje
 * no se debilita: `configHash` y `rollHash` siguen dentro, y el log completo está encadenado aparte
 * (INV-19). Reportado como contradicción de la especificación.
 */
export function resultHashPreimage(result: Omit<DecisionResult, 'resultHash'>): JsonObject {
  return {
    decisionId: result.decisionId,
    configHash: result.configHash,
    rollHash: result.rollHash,
    engineVersion: result.engineVersion,
    outcome: canonicalOutcome(result.outcome),
    turnout: {
      cast: result.turnout.cast,
      represented: result.turnout.represented,
      census: result.turnout.census,
      fraction: canonicalFraction(result.turnout.fraction),
    },
    weights: {
      totalWeight: result.weights.totalWeight,
      hhi: canonicalFraction(result.weights.hhi),
      gini: canonicalFraction(result.weights.gini),
    },
    quorumCheck: {
      passed: result.quorumCheck.passed,
      detail: { ...result.quorumCheck.detail },
    },
    proof: {
      narrative: result.proof.narrative,
      steps: result.proof.steps.map((s) => ({
        id: s.id,
        claim: s.claim,
        evidence: { ...s.evidence },
        supportingSeqs: [...s.supportingSeqs],
      })),
      tables: result.proof.tables.map((t) => ({
        title: t.title,
        columns: [...t.columns],
        rows: t.rows.map((row) => [...row]),
      })),
    },
  };
}

export async function computeResultHash(result: Omit<DecisionResult, 'resultHash'>): Promise<Hash> {
  return hashCanonical(resultHashPreimage(result));
}

/** Lo que devuelve cada escrutador antes de envolverse en un `DecisionResult`. */
export interface MethodTally {
  readonly outcome: Outcome;
  readonly steps: readonly ProofStep[];
  readonly tables: readonly ProofTable[];
  readonly narrative: string;
}

/** Tabla legible con el recuento binario. La misma para los tres métodos de umbral. */
export function binaryTable(counts: {
  approve: number;
  reject: number;
  abstain: number;
  silence: number;
}): ProofTable {
  return {
    title: 'Recuento',
    columns: ['Casilla', 'Peso'],
    rows: [
      ['A favor', counts.approve],
      ['En contra', counts.reject],
      ['Abstención explícita', counts.abstain],
      ['No votó', counts.silence],
    ],
  };
}

/** `p/q` legible, para la evidencia de los pasos. */
export function fractionEvidence(f: Fraction): string {
  return toFractionString(f);
}
