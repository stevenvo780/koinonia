/**
 * Autoría temporalmente oculta, y orden de presentación aleatorio pero verificable.
 *
 * ═══ El problema ═══
 *
 * Durante `perspectivas` la autoría no se muestra, y se destapa al cerrar la etapa. El evento es
 * **público en el historial**: cualquiera que lo lea ve el payload entero. Por lo tanto el `authorId`
 * no puede ir en el evento. Un campo que la interfaz «no pinta» no oculta absolutamente nada; lo
 * único que oculta un dato es que el dato no esté.
 *
 * ═══ El esquema ═══
 *
 *  1. La orden recibe `actor`, `contributionId`, un `nonce` por aporte y un `deliberationNonce`
 *     secreto de 128 bits. Ambos entran como datos: este paquete no produce aleatoriedad.
 *  2. Se arma la apertura canónica
 *     `{ domain: 'koinonia/deliberation-author/v1', deliberationId, contributionId, authorId, nonce }`.
 *  3. `authorCommitment = hashCanonical(apertura)` y `authorPseudonym = hashCanonical({ domain:
 *     'koinonia/deliberation-pseudonym/v1', deliberationId, authorId, deliberationNonce })`.
 *  4. `ContributionSubmitted` lleva el compromiso y el seudónimo, pero **ni `authorId`, ni `nonce`,
 *     ni `deliberationNonce`**. El seudónimo permite contar aportes de la misma persona sólo dentro
 *     de esta deliberación. Además el `actor` del sobre encadenado es `'system'`.
 *  5. Al revelar, `ContributionAuthorRevealed` publica `authorId`, `nonce` y `deliberationNonce`; el
 *     dominio recomputa y compara ambos hashes. Por eso la autoría no se puede falsificar después.
 *
 * // El opening vive en el private-material-store (ADR-0045), nunca en el ledger.
 *
 * ═══ Límite declarado — qué NO garantiza esto ═══
 *
 * Quien tenga acceso a la bóveda puede conocer la autoría antes del cierre. Se declara en vez de
 * fingir la garantía, igual que hace C6 con el secreto del voto. No lo tapamos: el compromiso
 * protege frente a **quien lee el historial** —o sea, frente al Instituto entero, que es de quien hay
 * que proteger la deliberación a ciegas— y no frente a quien administra el almacén privado. Un
 * esquema que sí lo lograra (cifrado umbral, pruebas de conocimiento cero) exige aritmética de curva
 * elíptica y por tanto dependencias de runtime, que es exactamente lo que ADR-0001 prohíbe en este
 * paquete. El seudónimo tampoco cambia ese límite: la bóveda conoce el secreto de deliberación.
 *
 * ═══ El orden de presentación ═══
 *
 * Si todo el mundo lee los aportes en el mismo orden, el primero de la lista pesa más que el último
 * por el simple hecho de estar arriba. El orden se aleatoriza **por lectora**, de forma determinista
 * y recomputable: la semilla de presentación entra como dato en el evento que abre la etapa, así que
 * cualquiera puede rehacer el orden que vio cualquier otra persona y comprobar que no hubo dedo. El
 * orden es una permutación: nadie ve más ni menos aportes que nadie.
 */

import { hashCanonical } from '../canonical.js';
import { PreconditionError } from '../errors.js';
import { compareIds, type Hash, type MemberId } from '../ids.js';
import {
  type AuthorNonce,
  type ContributionId,
  type ContributionRecord,
  type DeliberationNonce,
  type DeliberationId,
  type DeliberationState,
  type PresentationSeed,
} from './types.js';

/** Separación de dominio del compromiso de autoría. */
export const AUTHOR_COMMITMENT_DOMAIN = 'koinonia/deliberation-author/v1';
/** Separación de dominio del seudónimo estable por deliberación. */
export const AUTHOR_PSEUDONYM_DOMAIN = 'koinonia/deliberation-pseudonym/v1';
/** Separación de dominio de la semilla por lectora. */
export const PRESENTATION_ORDER_DOMAIN = 'koinonia/deliberation-order/v1';
/** Separación de dominio de la puntuación de cada aporte. */
export const PRESENTATION_SCORE_DOMAIN = 'koinonia/deliberation-order-score/v1';

/**
 * La apertura del compromiso. **Nunca entra al historial**: la guarda la capa de aplicación.
 *
 * El campo `domain` no es decorativo: sin él, el mismo `hashCanonical` de otro objeto con las mismas
 * claves valdría como compromiso de autoría, y la separación de dominios existe justamente para que
 * un digest de un propósito no sirva para otro.
 */
export interface AuthorOpening {
  readonly domain: typeof AUTHOR_COMMITMENT_DOMAIN;
  readonly deliberationId: DeliberationId;
  readonly contributionId: ContributionId;
  readonly authorId: MemberId;
  readonly nonce: AuthorNonce;
}

export interface AuthorOpeningInput {
  readonly deliberationId: DeliberationId;
  readonly contributionId: ContributionId;
  readonly authorId: MemberId;
  readonly nonce: AuthorNonce;
}

export function buildAuthorOpening(input: AuthorOpeningInput): AuthorOpening {
  return {
    domain: AUTHOR_COMMITMENT_DOMAIN,
    deliberationId: input.deliberationId,
    contributionId: input.contributionId,
    authorId: input.authorId,
    nonce: input.nonce,
  };
}

/** `sha256Hex(jcs(apertura))`. Es lo único de la autoría que viaja en el evento sellado. */
export async function authorCommitment(input: AuthorOpeningInput): Promise<Hash> {
  return hashCanonical(buildAuthorOpening(input));
}

export interface AuthorPseudonymInput {
  readonly deliberationId: DeliberationId;
  readonly authorId: MemberId;
  readonly deliberationNonce: DeliberationNonce;
}

/**
 * Seudónimo no enlazable entre deliberaciones: el secreto por deliberación impide que el ledger
 * permita probar los miembros candidatos por diccionario mientras la etapa siga sellada.
 */
export async function authorPseudonym(input: AuthorPseudonymInput): Promise<Hash> {
  return hashCanonical({
    domain: AUTHOR_PSEUDONYM_DOMAIN,
    deliberationId: input.deliberationId,
    authorId: input.authorId,
    deliberationNonce: input.deliberationNonce,
  });
}

/** Comprueba la atribución seudónima al revelar junto con el compromiso por aporte. */
export async function assertAuthorPseudonym(
  expected: Hash,
  input: AuthorPseudonymInput,
): Promise<void> {
  const actual = await authorPseudonym(input);
  if (actual !== expected) {
    throw new PreconditionError(
      'PSEUDONYM_MISMATCH',
      `la apertura no corresponde al seudónimo sellado: se esperaba ${expected} y se obtuvo ` +
        `${actual}. La atribución anónima no se puede reescribir después de la etapa`,
    );
  }
}

/**
 * Recomputa el compromiso y lo compara. Lanza `COMMITMENT_MISMATCH` si no coincide.
 *
 * Se llama **también en el replay**, no sólo en la orden: un historial fabricado a mano en el que
 * alguien se atribuye la perspectiva de otra persona no se pliega, se rechaza.
 */
export async function assertAuthorCommitment(
  expected: Hash,
  input: AuthorOpeningInput,
): Promise<void> {
  const actual = await authorCommitment(input);
  if (actual !== expected) {
    throw new PreconditionError(
      'COMMITMENT_MISMATCH',
      `la apertura no corresponde al compromiso sellado: se esperaba ${expected} y se obtuvo ` +
        `${actual}. La autoría de una perspectiva no se puede reescribir después de la etapa`,
    );
  }
}

/** Variante no excepcional. Para explicar en la interfaz, nunca para decidir si se escribe. */
export async function isAuthorCommitmentValid(
  expected: Hash,
  input: AuthorOpeningInput,
): Promise<boolean> {
  return (await authorCommitment(input)) === expected;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Orden de presentación
// ═════════════════════════════════════════════════════════════════════════════════════════════

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
