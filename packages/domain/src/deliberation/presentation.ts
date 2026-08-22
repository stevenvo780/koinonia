/**
 * Orden de presentación: aleatorio por lectora, determinista y recomputable por un tercero.
 *
 * ═══ El problema ═══
 *
 * Si todo el mundo lee los aportes en el mismo orden, el primero de la lista pesa más que el último
 * por el simple hecho de estar arriba. Es un sesgo de posición, y no lo arregla pedirle a la gente
 * que lea con cuidado.
 *
 * ═══ El esquema ═══
 *
 * El orden se aleatoriza **por lectora**: la semilla de presentación entra como dato en el evento
 * que abre la etapa, así que cualquiera puede rehacer el orden que vio cualquier otra persona y
 * comprobar que no hubo dedo. El orden es una permutación: nadie ve más ni menos aportes que nadie.
 *
 * ═══ Lo que este fichero YA NO hace ═══
 *
 * Hasta ADR-0049 aquí vivían el compromiso de autoría y el seudónimo por deliberación. Los dos se
 * retiraron con el sellado. La autoría no se oculta escondiendo el dato del evento: se oculta
 * **denegando su lectura** mientras la etapa `perspectivas` siga abierta, y esa regla vive en
 * `access.ts` como cualquier otra. Ver `docs/adr/0049-autoria-por-alcance-de-etapa.md`.
 */

import { hashCanonical } from '../canonical.js';
import { PreconditionError } from '../errors.js';
import { compareIds, type Hash, type MemberId } from '../ids.js';
import {
  type ContributionId,
  type ContributionRecord,
  type DeliberationId,
  type DeliberationState,
  type PresentationSeed,
} from './types.js';

/** Separación de dominio de la semilla por lectora. */
export const PRESENTATION_ORDER_DOMAIN = 'koinonia/deliberation-order/v1';
/** Separación de dominio de la puntuación de cada aporte. */
export const PRESENTATION_SCORE_DOMAIN = 'koinonia/deliberation-order-score/v1';

export interface ReaderSeedInput {
  readonly presentationSeed: PresentationSeed;
  readonly deliberationId: DeliberationId;
  readonly viewerId: MemberId;
}

/** `hash({domain, presentationSeed, deliberationId, viewerId})`: una semilla distinta por lectora. */
export async function readerSeed(input: ReaderSeedInput): Promise<Hash> {
  return hashCanonical({
    domain: PRESENTATION_ORDER_DOMAIN,
    presentationSeed: input.presentationSeed,
    deliberationId: input.deliberationId,
    viewerId: input.viewerId,
  });
}

/** `hash({domain, readerSeed, contributionId})`: la posición de un aporte para esa lectora. */
export async function contributionScore(seed: Hash, id: ContributionId): Promise<Hash> {
  return hashCanonical({
    domain: PRESENTATION_SCORE_DOMAIN,
    readerSeed: seed,
    contributionId: id,
  });
}

export interface PresentationOrderInput {
  readonly deliberationId: DeliberationId;
  readonly presentationSeed: PresentationSeed;
  readonly viewerId: MemberId;
  readonly contributionIds: readonly ContributionId[];
}

/**
 * Permutación determinista de los aportes para una lectora.
 *
 * Se ordena por los bytes de la puntuación —hexadecimal en minúscula, así que comparar unidades de
 * código UTF-16 con `<` es comparar los bytes— y **jamás** con `localeCompare`, que depende de ICU y
 * de la locale del proceso (ADR-0004). El desempate por `contributionId` no es defensivo: es lo que
 * hace que el orden sea un orden total y no dependa de la estabilidad del algoritmo de `sort`.
 */
export async function presentationOrder(
  input: PresentationOrderInput,
): Promise<readonly ContributionId[]> {
  const seed = await readerSeed({
    presentationSeed: input.presentationSeed,
    deliberationId: input.deliberationId,
    viewerId: input.viewerId,
  });
  const scored: { readonly id: ContributionId; readonly score: Hash }[] = [];
  for (const id of input.contributionIds) {
    scored.push({ id, score: await contributionScore(seed, id) });
  }
  return scored
    .sort((a, b) => {
      const byScore = compareIds(a.score, b.score);
      return byScore === 0 ? compareIds(a.id, b.id) : byScore;
    })
    .map((entry) => entry.id);
}

/** El mismo orden, aplicado a los registros del estado vigente. */
export async function orderContributionsForViewer(
  state: DeliberationState,
  viewerId: MemberId,
  contributions: readonly ContributionRecord[] = state.contributions,
): Promise<readonly ContributionRecord[]> {
  if (state.presentationSeed === undefined) {
    throw new PreconditionError(
      'DELIBERATION_NOT_OPEN',
      'una deliberación sin semilla de presentación no se puede ordenar: todavía no existe',
    );
  }
  const order = await presentationOrder({
    deliberationId: state.deliberationId,
    presentationSeed: state.presentationSeed,
    viewerId,
    contributionIds: contributions.map((c) => c.contributionId),
  });
  const byId = new Map(contributions.map((c) => [c.contributionId, c]));
  const out: ContributionRecord[] = [];
  for (const id of order) {
    const record = byId.get(id);
    if (record !== undefined) out.push(record);
  }
  return out;
}
