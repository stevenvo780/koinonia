/**
 * Órdenes de la constitución y **el pliegue**, que es donde vive la protección de verdad.
 *
 * ═══ Lo que este módulo NO puede hacer, dicho sin suavizar ═══
 *
 * **La aprobación M-de-N de Garantías (§6.6) no está asegurada criptográficamente, y nada impide que
 * quien administra el servidor fabrique las tres aprobaciones.**
 *
 * `ReformApprovedByGuarantor` es un evento del ledger con un `guarantorId` y un `actor` que tienen
 * que coincidir. Eso ata la aprobación a una identidad **dentro del sistema**, no a una llave que
 * sólo esa persona tenga. Firmar de verdad exigiría criptografía asimétrica —Ed25519 o similar— y
 * ADR-0001 prohíbe dependencias de tiempo de ejecución en `packages/domain`, que es la condición de
 * que un tercero pueda recomputar cualquier escrutinio con una página estática. No hay aquí una
 * firma; hay un registro de que alguien dijo que firmó.
 *
 * Lo que sí hay es **detección**. Las aprobaciones son eventos del historial encadenado; el
 * historial se ancla fuera del servidor con quórum 2-de-3 (ADR-0016, `packages/anchor`); una
 * aprobación fabricada queda anclada con fecha y autor, y la persona a la que se le atribuyó puede
 * repudiarla en público señalando el evento exacto. Es la estrategia declarada del proyecto frente
 * al adversario nº 2 —el administrador técnico—: no se le impide mentir, se hace imposible que
 * mienta sin dejar rastro. Quien lea esto y necesite prevención y no detección, tiene que llevar la
 * firma fuera del dominio, a un puerto con criptografía asimétrica, y este comentario es la deuda.
 *
 * La interfaz **no puede** llamar «firma» a esto sin decir lo anterior, igual que C6 obliga a
 * declarar lo que el secreto del voto no da.
 *
 * ═══ Por qué las comprobaciones están en el pliegue y no en la orden ═══
 *
 * La orden es **una** puerta. El pliegue es por donde pasa **todo** historial: el que escribe esta
 * API, el que sale de una restauración de copia de seguridad y el que alguien trae en un fichero.
 * Una regla que sólo estuviera en la orden se saltaría escribiendo el evento por otro camino y el
 * historial resultante se plegaría tan tranquilo. Por eso `applyConstitution` revalida **todo**:
 * umbrales, plazos, la copia congelada, la identidad de quien aprueba y —en cada evento, sin
 * excepción— el núcleo intangible.
 *
 * ═══ La copia congelada, y por qué el pliegue la coteja ═══
 *
 * `ReformOpened` lleva las reglas por valor. Pero una copia que nadie coteja es una copia que se
 * puede inventar: bastaría con abrir la reforma declarando un umbral de 1/2 para juzgarla con él.
 * Así que el pliegue comprueba dos cosas distintas y ambas hacen falta: **(1)** al abrir, que la
 * copia coincida exactamente con las reglas vigentes en ese momento; **(2)** después, que todo se
 * juzgue contra la copia y **nunca** contra las reglas vigentes. La primera hace honesta a la
 * copia; la segunda la hace útil.
 */

import { type Actor, authorize } from '../access.js';
import { PreconditionError } from '../errors.js';
import {
  type DecisionId,
  type EventId,
  type Hash,
  type Instant,
  isStrictlySorted,
  type MemberId,
} from '../ids.js';
import { formatBogota } from '../window.js';
import { appendChained, verifyChain } from '../workspace/chain.js';
import {
  addDays,
  addMonths,
  assertCount,
  assertCoreIntact,
  assertOutsideOwnWindow,
  assertSameCore,
  assertWellFormedCore,
  assertWellFormedText,
  canonicalEquals,
  changedClauseIds,
  CoreAlteredError,
  constitutionCoreHash,
  DAY_MS,
  diffTexts,
  FOUNDING_APPROVAL_OF_BALLOTS,
  FOUNDING_MIN_PARTICIPATION,
  meetsShareOf,
  requiredCount,
} from './core.js';
import { assertAcceptedAt, nextReformStatus, statusAt } from './state-machine.js';
import {
  type Clause,
  type ClauseId,
  type ConstitutionEvent,
  type ConstitutionId,
  constitutionId as toConstitutionId,
  type ConstitutionLog,
  type ConstitutionPayload,
  type ConstitutionState,
  type ConstitutionText,
  type ConstitutionVersion,
  currentText,
  currentVersionOf,
  findReform,
  type FrozenReformRules,
  initialConstitutionState,
  type ReformCalendar,
  type ReformId,
  type ReformKind,
  type ReformRecord,
  type ReformRejectionReason,
  type ReformVote,
  requirementsFor,
  versionAt,
} from './types.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Auxiliares del pliegue
// ═════════════════════════════════════════════════════════════════════════════════════════════

function requireText(state: ConstitutionState): ConstitutionText {
  const text = currentText(state);
  if (text === undefined) {
    throw new PreconditionError('CONSTITUTION_NOT_FOUNDED', 'no hay texto vigente');
  }
  return text;
}

function requireReform(state: ConstitutionState, id: ReformId): ReformRecord {
  const reform = findReform(state, id);
  if (reform === undefined) {
    throw new PreconditionError(
      'UNKNOWN_REFORM',
      'esa reforma no existe en este historial: no hay acto sobre una reforma que nadie abrió',
    );
  }
  return reform;
}

/** Las cláusulas que la reforma toca, medidas contra el texto de **su** versión objetivo. */
function reformChanges(state: ConstitutionState, reform: ReformRecord): readonly ClauseId[] {
  const target = versionAt(state, reform.targetVersion);
  if (target === undefined) {
    throw new PreconditionError(
      'UNKNOWN_TARGET_VERSION',
      `la reforma dice partir de la versión ${String(reform.targetVersion)}, que no está en el ` +
        'historial',
    );
  }
  return changedClauseIds(target.text, reform.proposedText);
}

function assertWindow(opensAt: Instant, closesAt: Instant): void {
  if (closesAt <= opensAt) {
    throw new PreconditionError('WINDOW_INVERTED', 'una ventana tiene que cerrar después de abrir');
  }
}

function assertNotAboveCensus(value: number, censusSize: number, field: string): void {
  assertCount(value, field);
  if (value > censusSize) {
    throw new PreconditionError(
      'COUNT_ABOVE_CENSUS',
      `${field} vale ${String(value)} sobre un censo de ${String(censusSize)}: un conteo mayor ` +
        'que el padrón congelado no es un resultado, es un error de transcripción o un fraude',
    );
  }
}

/** Los dos umbrales de una votación de reforma, contra la copia congelada. */
function voteMeetsThresholds(vote: ReformVote, frozen: FrozenReformRules): boolean {
  const { requirements: req, censusSize } = frozen;
  return (
    meetsShareOf(vote.votesInFavor, req.approvalOfCensus, censusSize) &&
    meetsShareOf(vote.directParticipation, req.minDirectParticipation, censusSize)
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El pliegue
// ═════════════════════════════════════════════════════════════════════════════════════════════

function applyFounded(
  state: ConstitutionState,
  event: ConstitutionEvent,
  payload: Extract<ConstitutionPayload, { type: 'ConstitutionFounded' }>,
): ConstitutionState {
  const genesis = !state.exists;
  if (genesis) {
    assertWellFormedCore(payload.core);
  } else {
    if (statusAt(state, event.occurredAt) !== 'caducada') {
      throw new PreconditionError(
        'CONSTITUTION_STILL_VIGENT',
        'ya hay una constitución vigente: fundar otra encima no es fundar, es un golpe. Se ' +
          'reforma por la fila 13, o se espera a que caduque y se refunda en público',
      );
    }
    // Ni la refundación toca el núcleo. Ver `assertSameCore`: refundar con otro núcleo es empezar
    // otra comunidad, con otro historial. Si no fuera así, dejar caducar la constitución sería la
    // vía barata para vaciar el núcleo, y la caducidad volvería a ser lo que no debe ser: una
    // puerta trasera con paciencia.
    assertSameCore(state.core, payload.core);
  }

  if (payload.version !== state.currentVersion + 1) {
    throw new PreconditionError(
      'NON_CONSECUTIVE_VERSION',
      `la versión tiene que ser ${String(state.currentVersion + 1)} y llegó ` +
        `${String(payload.version)}: las versiones son densas para que «la anterior» siempre ` +
        'exista y la diferencia publicada se pueda comprobar (§6.5)',
    );
  }

  assertWellFormedText(payload.text);
  assertCoreIntact(payload.core, payload.text);

  const { censusSize, castBallots, votesInFavor, directParticipation } = payload;
  assertCount(censusSize, 'censusSize');
  if (censusSize < 1) {
    throw new PreconditionError('EMPTY_CENSUS', 'no se funda nada sobre un censo vacío');
  }
  assertNotAboveCensus(castBallots, censusSize, 'castBallots');
  assertNotAboveCensus(directParticipation, censusSize, 'directParticipation');
  assertNotAboveCensus(votesInFavor, castBallots, 'votesInFavor');
  if (castBallots < 1) {
    throw new PreconditionError(
      'NO_BALLOTS',
      'una fundación sin papeletas computables no tiene umbral que superar',
    );
  }
  if (directParticipation > castBallots) {
    throw new PreconditionError(
      'INVALID_PARTICIPATION',
      'hay más personas votando directamente que papeletas: cada voto directo es una papeleta',
    );
  }
  // §6, «el problema del arranque»: 2/3 de las PAPELETAS —no del censo— con participación mínima
  // de 100 sobre 300. Es más baja que la de reforma ordinaria, y el documento lo dice con todas las
  // letras: es más fácil aprobar la primera constitución que reformarla.
  if (!meetsShareOf(votesInFavor, FOUNDING_APPROVAL_OF_BALLOTS, castBallots)) {
    throw new PreconditionError(
      'FOUNDING_THRESHOLD_NOT_MET',
      `hacen falta ${String(requiredCount(FOUNDING_APPROVAL_OF_BALLOTS, castBallots))} votos a ` +
        `favor de ${String(castBallots)} papeletas y hay ${String(votesInFavor)}`,
    );
  }
  if (!meetsShareOf(directParticipation, FOUNDING_MIN_PARTICIPATION, censusSize)) {
    throw new PreconditionError(
      'FOUNDING_PARTICIPATION_NOT_MET',
      `hacen falta ${String(requiredCount(FOUNDING_MIN_PARTICIPATION, censusSize))} personas ` +
        `votando directamente y hay ${String(directParticipation)}`,
    );
  }
  if (payload.effectiveAt < event.occurredAt) {
    throw new PreconditionError(
      'EFFECTIVE_IN_THE_PAST',
      'una constitución no entra en vigor antes del acto que la funda',
    );
  }

  const version: ConstitutionVersion = {
    version: payload.version,
    text: payload.text,
    reformId: undefined,
    foundingDecisionId: payload.foundingDecisionId,
    effectiveAt: payload.effectiveAt,
    expiresAt: addMonths(payload.effectiveAt, payload.text.validityMonths),
    seq: event.seq,
  };
  return {
    ...state,
    lastSeq: event.seq,
    exists: true,
    core: genesis ? payload.core : state.core,
    versions: [...state.versions, version],
    currentVersion: payload.version,
    foundations: state.foundations + 1,
  };
}

function applyReformOpened(
  state: ConstitutionState,
  event: ConstitutionEvent,
  actor: MemberId,
  payload: Extract<ConstitutionPayload, { type: 'ReformOpened' }>,
): ConstitutionState {
  const text = requireText(state);
  if (findReform(state, payload.reformId) !== undefined) {
    throw new PreconditionError(
      'DUPLICATE_REFORM',
      'ese identificador de reforma ya está en el historial',
    );
  }
  if (payload.targetVersion !== state.currentVersion) {
    throw new PreconditionError(
      'STALE_REFORM_TARGET',
      `la reforma dice partir de la versión ${String(payload.targetVersion)} y la vigente es ` +
        `${String(state.currentVersion)}: una reforma se abre sobre el texto que hay, no sobre ` +
        'el que había cuando alguien abrió la pantalla',
    );
  }

  // (1) La copia congelada tiene que ser una copia FIEL de lo vigente. Sin esto, congelar sería
  // elegir con qué reglas se juzga uno mismo, que es peor que no congelar nada.
  const vigent = requirementsFor(text, payload.kind);
  if (!canonicalEquals(payload.frozen.requirements, vigent)) {
    throw new PreconditionError(
      'FROZEN_RULES_MISMATCH',
      'la copia congelada no coincide con las reglas vigentes al abrir: una reforma no elige el ' +
        'umbral con el que se la mide',
    );
  }

  const { frozen } = payload;
  assertCount(frozen.censusSize, 'frozen.censusSize');
  if (frozen.censusSize < 1) {
    throw new PreconditionError('EMPTY_CENSUS', 'no se reforma nada sobre un censo vacío');
  }
  if (frozen.guarantors.length !== vigent.guaranteeCircleSize) {
    throw new PreconditionError(
      'GUARANTEE_CIRCLE_MISMATCH',
      `el texto dice que Garantías son ${String(vigent.guaranteeCircleSize)} personas y se ` +
        `congelaron ${String(frozen.guarantors.length)}`,
    );
  }
  if (!isStrictlySorted(frozen.guarantors)) {
    throw new PreconditionError(
      'GUARANTORS_NOT_SORTED',
      'el Círculo de Garantías congelado va ordenado y sin repetir: repetir a una persona sería ' +
        'contarle dos firmas',
    );
  }
  if (!isStrictlySorted(frozen.calendar.convened.map((d) => d.decisionId))) {
    throw new PreconditionError(
      'CONVENED_NOT_SORTED',
      'las decisiones ya convocadas van ordenadas y sin repetir (A.1.1.1)',
    );
  }

  assertCount(payload.sponsorCount, 'sponsorCount');
  if (!meetsShareOf(payload.sponsorCount, vigent.sponsorSignatures, frozen.censusSize)) {
    throw new PreconditionError(
      'NOT_ENOUGH_SPONSORS',
      `abrir esta reforma exige ${String(requiredCount(vigent.sponsorSignatures, frozen.censusSize))}` +
        ` firmas y llegaron ${String(payload.sponsorCount)}`,
    );
  }

  if (payload.deliberationOpensAt < event.occurredAt) {
    throw new PreconditionError(
      'WINDOW_OPENS_IN_THE_PAST',
      'la deliberación no se abre en el pasado: sería abrirla y cerrarla en el mismo acto',
    );
  }
  assertWindow(payload.deliberationOpensAt, payload.deliberationClosesAt);
  if (
    payload.deliberationClosesAt - payload.deliberationOpensAt <
    vigent.deliberationDays * DAY_MS
  ) {
    throw new PreconditionError(
      'DELIBERATION_TOO_SHORT',
      `la deliberación previa dura al menos ${String(vigent.deliberationDays)} días (§6.1): las ` +
        'reglas no se cambian con media comunidad dormida',
    );
  }

  assertWellFormedText(payload.proposedText);
  // El núcleo, en el texto PROPUESTO. Se comprueba al abrir para no dejar deliberar veintiún días
  // sobre algo que no se puede ratificar; y se vuelve a comprobar al ratificar, porque la garantía
  // no puede depender de que este evento se haya escrito por la puerta.
  assertCoreIntact(state.core, payload.proposedText);

  const diff = diffTexts(text, payload.proposedText);
  if (diff.touchesAmendmentRule && payload.kind !== 'atrincherada') {
    throw new PreconditionError(
      'AMENDMENT_RULE_IS_ENTRENCHED',
      'esta reforma cambia la cláusula de enmienda —los requisitos de reforma o la vigencia—, y ' +
        'eso va por la fila 14: 3/4 del censo en dos votaciones separadas por un semestre, con ' +
        '4 de 5 de Garantías (§6.a). Una mayoría de hoy no se hace inamovible cambiando la regla ' +
        'de cambio',
    );
  }

  const record: ReformRecord = {
    reformId: payload.reformId,
    kind: payload.kind,
    status: nextReformStatus('inexistente', payload.type),
    targetVersion: payload.targetVersion,
    proposedText: payload.proposedText,
    frozen: payload.frozen,
    sponsorCount: payload.sponsorCount,
    deliberationOpensAt: payload.deliberationOpensAt,
    deliberationClosesAt: payload.deliberationClosesAt,
    votes: [],
    approvals: [],
    rejection: undefined,
    proposedBy: actor,
    openedAt: event.occurredAt,
    seq: event.seq,
  };
  return { ...state, lastSeq: event.seq, reforms: [...state.reforms, record] };
}

function replaceReform(
  state: ConstitutionState,
  seq: number,
  updated: ReformRecord,
): ConstitutionState {
  return {
    ...state,
    lastSeq: seq,
    reforms: state.reforms.map((r) => (r.reformId === updated.reformId ? updated : r)),
  };
}

function applyVoteRecorded(
  state: ConstitutionState,
  event: ConstitutionEvent,
  payload: Extract<ConstitutionPayload, { type: 'ReformVoteRecorded' }>,
): ConstitutionState {
  const reform = requireReform(state, payload.reformId);
  const status = nextReformStatus(reform.status, payload.type);
  const { requirements: req, censusSize } = reform.frozen;
  const vote = payload.vote;

  if (vote.round !== reform.votes.length + 1) {
    throw new PreconditionError(
      'NON_CONSECUTIVE_ROUND',
      `esta reforma va por la ronda ${String(reform.votes.length + 1)} y el evento dice ` +
        String(vote.round),
    );
  }
  if (vote.round > req.votesRequired) {
    throw new PreconditionError(
      'TOO_MANY_ROUNDS',
      `la copia congelada exige ${String(req.votesRequired)} votación(es) y ésta sería la ` +
        `${String(vote.round)}: repetir la votación hasta que salga es exactamente lo que la ` +
        'doble llave temporal impide',
    );
  }
  assertWindow(vote.opensAt, vote.closesAt);
  if (vote.opensAt < reform.deliberationClosesAt) {
    throw new PreconditionError(
      'VOTE_BEFORE_DELIBERATION_CLOSES',
      'la votación no abre antes de que cierre la deliberación: los 21 días son PREVIOS (§6.1)',
    );
  }
  if (event.occurredAt < vote.closesAt) {
    throw new PreconditionError(
      'VOTE_NOT_CLOSED',
      'no se registra el resultado de una urna que sigue abierta',
    );
  }
  assertNotAboveCensus(vote.votesInFavor, censusSize, 'vote.votesInFavor');
  assertNotAboveCensus(vote.directParticipation, censusSize, 'vote.directParticipation');

  const previous = reform.votes.at(-1);
  if (previous !== undefined) {
    const earliest = addMonths(previous.closesAt, req.separationMonths);
    if (vote.closesAt < earliest) {
      throw new PreconditionError(
        'VOTES_TOO_CLOSE',
        `la segunda votación no puede cerrar antes del ${formatBogota(earliest)}: un semestre ` +
          'dura más que una coyuntura y garantiza que el cuerpo que vota la segunda vez no sea ' +
          'el mismo (§6.a)',
      );
    }
  }

  // §6.c — la ventana propia, medida contra el calendario CONGELADO al abrir.
  assertOutsideOwnWindow(
    vote.opensAt,
    vote.closesAt,
    reform.frozen.calendar,
    reformChanges(state, reform),
  );

  return replaceReform(state, event.seq, {
    ...reform,
    status,
    votes: [...reform.votes, vote],
  });
}

function applyGuaranteeApproval(
  state: ConstitutionState,
  event: ConstitutionEvent,
  actor: MemberId,
  payload: Extract<ConstitutionPayload, { type: 'ReformApprovedByGuarantor' }>,
): ConstitutionState {
  const reform = requireReform(state, payload.reformId);
  const status = nextReformStatus(reform.status, payload.type);
  const { requirements: req } = reform.frozen;

  if (reform.votes.length !== req.votesRequired) {
    throw new PreconditionError(
      'VOTES_INCOMPLETE',
      'Garantías verifica el procedimiento (§6.6) y el procedimiento exige ' +
        `${String(req.votesRequired)} votación(es); hay ${String(reform.votes.length)}`,
    );
  }
  if (!reform.frozen.guarantors.includes(payload.guarantorId)) {
    throw new PreconditionError(
      'NOT_A_GUARANTOR',
      'quien aprueba no estaba en el Círculo de Garantías congelado al abrir la reforma: una ' +
        'firma no la pone alguien que entró al círculo después',
    );
  }
  if (reform.approvals.includes(payload.guarantorId)) {
    throw new PreconditionError(
      'DUPLICATE_APPROVAL',
      'esa persona ya aprobó: M de N son M personas distintas',
    );
  }
  // Reautorización en el pliegue: el sobre y la aprobación nombran a la misma persona. No es una
  // firma —ver la cabecera—, pero al menos una aprobación fabricada tiene que fabricarse a nombre
  // de alguien concreto, con su identificador, en un evento anclado que esa persona puede repudiar.
  if (actor !== payload.guarantorId) {
    throw new PreconditionError(
      'NOT_THE_GUARANTOR',
      'la aprobación se atribuye a alguien que no es quien la escribió',
    );
  }

  return replaceReform(state, event.seq, {
    ...reform,
    status,
    approvals: [...reform.approvals, payload.guarantorId],
  });
}

function applyRatified(
  state: ConstitutionState,
  event: ConstitutionEvent,
  payload: Extract<ConstitutionPayload, { type: 'ReformRatified' }>,
): ConstitutionState {
  const reform = requireReform(state, payload.reformId);
  const status = nextReformStatus(reform.status, payload.type);
  const { requirements: req, censusSize } = reform.frozen;

  // ─── Concurrencia optimista ────────────────────────────────────────────────────────────────
  // Dos reformas abiertas sobre la versión 3 pueden votarse las dos; ratificarse, sólo una. La
  // segunda encuentra que la versión vigente ya es la 4 y se cae aquí. Sin esto, la segunda
  // ratificación construiría su versión sobre un texto que nadie votó: el suyo, ignorando lo que
  // la primera cambió.
  if (state.currentVersion !== reform.targetVersion) {
    throw new PreconditionError(
      'STALE_REFORM_TARGET',
      `esta reforma se votó sobre la versión ${String(reform.targetVersion)} y la vigente ya es ` +
        `la ${String(state.currentVersion)}: otra reforma se ratificó antes. Lo que se aprobó no ` +
        'es lo que quedaría vigente, así que no se ratifica: se vuelve a abrir sobre el texto de ' +
        'hoy',
    );
  }
  if (payload.version !== state.currentVersion + 1) {
    throw new PreconditionError(
      'NON_CONSECUTIVE_VERSION',
      `la versión tiene que ser ${String(state.currentVersion + 1)} y llegó ` +
        String(payload.version),
    );
  }
  if (reform.votes.length !== req.votesRequired) {
    throw new PreconditionError(
      'VOTES_INCOMPLETE',
      `la copia congelada exige ${String(req.votesRequired)} votación(es) y hay ` +
        String(reform.votes.length),
    );
  }
  for (const vote of reform.votes) {
    if (!meetsShareOf(vote.votesInFavor, req.approvalOfCensus, censusSize)) {
      throw new PreconditionError(
        'THRESHOLD_NOT_MET',
        `la ronda ${String(vote.round)} tiene ${String(vote.votesInFavor)} votos a favor y hacen ` +
          `falta ${String(requiredCount(req.approvalOfCensus, censusSize))} sobre un censo de ` +
          String(censusSize),
      );
    }
    if (!meetsShareOf(vote.directParticipation, req.minDirectParticipation, censusSize)) {
      throw new PreconditionError(
        'DIRECT_PARTICIPATION_NOT_MET',
        `la ronda ${String(vote.round)} tiene ${String(vote.directParticipation)} personas ` +
          `votando directamente y hacen falta ` +
          `${String(requiredCount(req.minDirectParticipation, censusSize))}. La delegación no ` +
          'cuenta para este mínimo: para lo constituyente la comunidad aparece con su propia mano',
      );
    }
  }
  for (let i = 1; i < reform.votes.length; i++) {
    const before = reform.votes[i - 1];
    const after = reform.votes[i];
    if (before === undefined || after === undefined) continue;
    if (after.closesAt < addMonths(before.closesAt, req.separationMonths)) {
      throw new PreconditionError(
        'VOTES_TOO_CLOSE',
        `entre las dos votaciones tienen que pasar ${String(req.separationMonths)} meses (§6.a)`,
      );
    }
  }
  if (reform.approvals.length < req.guaranteeThreshold) {
    throw new PreconditionError(
      'GUARANTEE_THRESHOLD_NOT_MET',
      `la puesta en vigor exige ${String(req.guaranteeThreshold)} de ` +
        `${String(req.guaranteeCircleSize)} de Garantías y hay ${String(reform.approvals.length)}` +
        '. Sin las firmas la regla queda aprobada pero no vigente, y eso es público (§6.6)',
    );
  }

  const last = reform.votes.at(-1);
  if (last === undefined) {
    throw new PreconditionError('VOTES_INCOMPLETE', 'no hay votación que ratificar');
  }
  const earliest = addDays(last.closesAt, req.waitingDays);
  if (payload.effectiveAt < earliest) {
    throw new PreconditionError(
      'WAITING_PERIOD_NOT_ELAPSED',
      `la regla no entra en vigor antes del ${formatBogota(earliest)}: son ` +
        `${String(req.waitingDays)} días de espera impugnables ante Garantías (§6.4)`,
    );
  }
  if (payload.effectiveAt < event.occurredAt) {
    throw new PreconditionError(
      'EFFECTIVE_IN_THE_PAST',
      'una regla no entra en vigor antes del acto que la ratifica',
    );
  }

  // El núcleo, otra vez, sobre el texto que está a punto de quedar vigente. Redundante con la
  // comprobación final de `applyConstitution` y con la de la apertura: es la que da el mensaje
  // exacto, y las tres son baratas.
  assertCoreIntact(state.core, reform.proposedText);

  const version: ConstitutionVersion = {
    version: payload.version,
    text: reform.proposedText,
    reformId: reform.reformId,
    foundingDecisionId: undefined,
    effectiveAt: payload.effectiveAt,
    expiresAt: addMonths(payload.effectiveAt, reform.proposedText.validityMonths),
    seq: event.seq,
  };
  const withReform = replaceReform(state, event.seq, { ...reform, status });
  return {
    ...withReform,
    versions: [...withReform.versions, version],
    currentVersion: payload.version,
  };
}

function applyRejected(
  state: ConstitutionState,
  event: ConstitutionEvent,
  actor: MemberId,
  payload: Extract<ConstitutionPayload, { type: 'ReformRejected' }>,
): ConstitutionState {
  const reform = requireReform(state, payload.reformId);
  const status = nextReformStatus(reform.status, payload.type);
  const { requirements: req, censusSize } = reform.frozen;

  // Cerrar una reforma exige un HECHO que lo sostenga, no una declaración. Sin esto, quien facilita
  // podría matar una reforma ganadora escribiendo «no alcanzó el umbral», y el motivo publicado
  // sería mentira comprobable pero la reforma estaría igual de muerta.
  const supported = ((): boolean => {
    switch (payload.reason) {
      case 'umbral_no_alcanzado':
        return reform.votes.some(
          (v) => !meetsShareOf(v.votesInFavor, req.approvalOfCensus, censusSize),
        );
      case 'voto_directo_insuficiente':
        return reform.votes.some(
          (v) => !meetsShareOf(v.directParticipation, req.minDirectParticipation, censusSize),
        );
      case 'sin_firmas_de_garantias': {
        const last = reform.votes.at(-1);
        if (last === undefined || reform.votes.length !== req.votesRequired) return false;
        // Se declara la ausencia de firmas cuando ya pasó la espera en la que debían llegar.
        return (
          reform.approvals.length < req.guaranteeThreshold &&
          event.occurredAt >= addDays(last.closesAt, req.waitingDays)
        );
      }
      case 'version_desplazada':
        return state.currentVersion !== reform.targetVersion;
      case 'retirada_por_quien_la_propuso':
        return actor === reform.proposedBy;
    }
  })();
  if (!supported) {
    throw new PreconditionError(
      'UNSUPPORTED_REJECTION',
      `el motivo «${payload.reason}» no se sostiene sobre este historial: cerrar una reforma ` +
        'exige un hecho comprobable, porque cerrarla es tan definitivo como ratificarla',
    );
  }

  return replaceReform(state, event.seq, { ...reform, status, rejection: payload.reason });
}

/**
 * Pliega un evento. Rechaza y deja el estado del llamante intacto si algo no cuadra.
 *
 * Es **síncrono**. Podría no serlo —hashear el núcleo con SHA-256 exigiría WebCrypto, que es
 * asíncrono—, y por eso el núcleo se compara por su **preimagen canónica** y no por su hash: la
 * igualdad es la misma, la comparación es exacta y el pliegue no depende de una API asíncrona.
 * `constitutionCoreHash` existe para publicar y anclar, que es donde el hash sí hace falta.
 */
export function applyConstitution(
  state: ConstitutionState,
  event: ConstitutionEvent,
): ConstitutionState {
  if (event.aggregateId !== state.constitutionId) {
    throw new PreconditionError(
      'WRONG_AGGREGATE',
      `el evento pertenece a ${event.aggregateId} y el agregado es ${state.constitutionId}`,
    );
  }
  const payload = event.payload;

  // Compuerta de vigencia ANTES que nada: con la constitución caducada sólo pasa la refundación, y
  // el motivo del rechazo no debe depender de qué traiga el evento dentro.
  assertAcceptedAt(state, payload.type, event.occurredAt);

  const actor = event.actor;
  if (actor === 'system') {
    throw new PreconditionError(
      'SYSTEM_CANNOT_GOVERN',
      'ningún acto de gobierno es un automatismo: todos tienen responsable con nombre propio ' +
        '(principio 1). Ni siquiera la caducidad, que no se escribe: se calcula',
    );
  }

  const next = ((): ConstitutionState => {
    switch (payload.type) {
      case 'ConstitutionFounded':
        return applyFounded(state, event, payload);
      case 'ReformOpened':
        return applyReformOpened(state, event, actor, payload);
      case 'ReformVoteRecorded':
        return applyVoteRecorded(state, event, payload);
      case 'ReformApprovedByGuarantor':
        return applyGuaranteeApproval(state, event, actor, payload);
      case 'ReformRatified':
        return applyRatified(state, event, payload);
      case 'ReformRejected':
        return applyRejected(state, event, actor, payload);
    }
  })();

  // ═══ El guardián del núcleo intangible ═══
  //
  // Se recomputa el núcleo desde el texto vigente y se compara con el que fijó el evento
  // fundacional. En CADA evento, incluidos los que no tocan el texto: la comprobación cuesta una
  // comparación de seis pares y su valor es que **no hay ningún camino** —ni una orden nueva que
  // alguien añada mañana, ni un evento fabricado a mano— que deje el núcleo alterado y el
  // historial plegable. Si esto lanza, el estado del llamante queda intacto porque el `next` que
  // se acaba de construir se descarta.
  const text = currentText(next);
  if (text !== undefined) assertCoreIntact(next.core, text);
  return next;
}

/** Pliega el historial completo. El orden canónico es por `seq`. */
export function replayConstitution(log: ConstitutionLog): ConstitutionState {
  const first = log[0];
  if (first === undefined) {
    throw new PreconditionError(
      'EMPTY_LOG',
      'un historial vacío no identifica ninguna constitución',
    );
  }
  let state = initialConstitutionState(toConstitutionId(first.aggregateId));
  for (const event of log) state = applyConstitution(state, event);
  return state;
}

export interface VerifyConstitutionOptions {
  /**
   * El hash del núcleo **publicado y anclado fuera** del servidor.
   *
   * Sin él, esta verificación no distingue un génesis honesto de uno reescrito de arriba abajo: el
   * pliegue compara contra el génesis, y si el génesis miente, miente el patrón. Con él, cambiar el
   * núcleo exige además alterar algo que está fuera del alcance de quien administra (ADR-0016).
   */
  readonly expectedCoreHash?: Hash | undefined;
}

/** Cadena intacta, historial plegable y —si se le da— núcleo igual al publicado. */
export async function verifyConstitutionLog(
  log: ConstitutionLog,
  options: VerifyConstitutionOptions = {},
): Promise<ConstitutionState> {
  await verifyChain(log);
  const state = replayConstitution(log);
  const expected = options.expectedCoreHash;
  if (expected !== undefined) {
    const actual = await constitutionCoreHash(state.core);
    if (actual !== expected) {
      throw new CoreAlteredError(
        'CORE_SET_ALTERED',
        `el núcleo de este historial hashea ${actual} y el publicado es ${expected}: o el ` +
          'historial no es el de esta comunidad, o alguien reescribió el evento fundacional',
      );
    }
  }
  return state;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lectura pública del estado
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Compuerta para el **resto** del sistema: mientras la constitución no esté vigente no se abre una
 * decisión, no se ratifica un acuerdo y no se cierra nada.
 *
 * El dominio la ofrece; llamarla desde cada agregado y desde la capa de servicio es deuda declarada
 * (ver el ADR): este agregado no puede imponerle nada a `engine.ts` sin acoplarlos.
 */
export function assertConstitutionVigent(state: ConstitutionState, at: Instant): void {
  const status = statusAt(state, at);
  if (status === 'vigente') return;
  throw new PreconditionError(
    status === 'caducada' ? 'CONSTITUTION_EXPIRED' : 'CONSTITUTION_NOT_FOUNDED',
    status === 'caducada'
      ? 'las reglas de la comunidad vencieron: hasta que la asamblea las vuelva a aprobar sólo se ' +
          'puede leer y exportar (§6)'
      : 'todavía no hay reglas aprobadas',
  );
}

/**
 * El aviso público del estado, en castellano llano y sin jerga (ADR-0041).
 *
 * La caducidad tiene que ser **visible**: un sistema que se queda sin reglas y no lo dice es un
 * sistema que sigue pareciendo legítimo mientras ya no lo es.
 */
export function constitutionNotice(state: ConstitutionState, at: Instant): string {
  const status = statusAt(state, at);
  if (status === 'inexistente') {
    return (
      'Koinonía todavía no tiene reglas aprobadas. Hasta que la asamblea apruebe la primera ' +
      'versión sólo se puede leer y exportar.'
    );
  }
  const version = currentVersionOf(state);
  if (version === undefined) return 'Koinonía todavía no tiene reglas aprobadas.';
  if (status === 'caducada') {
    return (
      `Las reglas de Koinonía vencieron el ${formatBogota(version.expiresAt)} y nadie las volvió ` +
      'a aprobar. Mientras tanto sólo se puede leer y exportar: no se abren votaciones, no se ' +
      'reforman reglas y no se cierran acuerdos. Ningún plazo vencido rebaja las mayorías que ' +
      'hacen falta para volver a aprobarlas.'
    );
  }
  return (
    `Rige la versión ${String(version.version)} de las reglas, en vigor desde el ` +
    `${formatBogota(version.effectiveAt)} y hasta el ${formatBogota(version.expiresAt)}. Si nadie ` +
    'la renueva antes de esa fecha, Koinonía se queda sin reglas.'
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Órdenes. Todas autorizan ANTES de construir el evento.
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ConstitutionCommandMeta {
  readonly eventId: EventId;
  /** El instante del servidor. Es el `now` contra el que se evalúa la caducidad: entra como dato. */
  readonly at: Instant;
  readonly actor: Actor;
}

function requireIdentity(meta: ConstitutionCommandMeta): MemberId {
  const memberId = meta.actor.memberId;
  if (memberId === undefined) {
    throw new PreconditionError('NOT_AUTHENTICATED', 'este acto exige una cuenta verificada');
  }
  return memberId;
}

async function emit(
  log: ConstitutionLog,
  state: ConstitutionState,
  aggregateId: ConstitutionId,
  meta: ConstitutionCommandMeta,
  actor: MemberId,
  payload: ConstitutionPayload,
): Promise<ConstitutionLog> {
  const event = await appendChained<ConstitutionPayload>(log, {
    eventId: meta.eventId,
    aggregateId,
    occurredAt: meta.at,
    actor,
    payload,
  });
  // Se pliega antes de devolver: una orden que produce un historial que `replayConstitution`
  // rechazaría es un historial ya roto en el momento de escribirse.
  applyConstitution(state, event);
  return [...log, event];
}

function stateOf(log: ConstitutionLog, fallbackId: ConstitutionId): ConstitutionState {
  return log.length === 0 ? initialConstitutionState(fallbackId) : replayConstitution(log);
}

export interface FoundConstitutionInput {
  /** Sólo se usa si el historial está vacío; en una refundación manda el del historial. */
  readonly constitutionId: ConstitutionId;
  readonly text: ConstitutionText;
  readonly core: readonly Clause[];
  readonly foundingDecisionId: DecisionId;
  readonly censusSize: number;
  readonly votesInFavor: number;
  readonly castBallots: number;
  readonly directParticipation: number;
  readonly effectiveAt: Instant;
}

/**
 * Funda la constitución, o la **refunda** después de una caducidad.
 *
 * La regla fundacional es la del §6 y **no** la de reforma: 2/3 de las papeletas con participación
 * mínima de un tercio del censo. Es más baja, y el documento lo dice sin rodeos porque la regla
 * fundacional no puede derivar su legitimidad de las reglas que ella misma establece. Lo que
 * compensa esa rebaja es la caducidad: nadie queda gobernado indefinidamente por reglas que aprobó
 * gente que ya se graduó.
 */
export async function foundConstitution(
  log: ConstitutionLog,
  meta: ConstitutionCommandMeta,
  input: FoundConstitutionInput,
): Promise<ConstitutionLog> {
  authorize(meta.actor, 'constitution:found', { kind: 'constitution' });
  const author = requireIdentity(meta);
  const state = stateOf(log, input.constitutionId);
  return emit(log, state, state.constitutionId, meta, author, {
    type: 'ConstitutionFounded',
    version: state.currentVersion + 1,
    text: input.text,
    core: input.core,
    foundingDecisionId: input.foundingDecisionId,
    censusSize: input.censusSize,
    votesInFavor: input.votesInFavor,
    castBallots: input.castBallots,
    directParticipation: input.directParticipation,
    effectiveAt: input.effectiveAt,
  });
}

export interface OpenReformInput {
  readonly reformId: ReformId;
  readonly kind: ReformKind;
  /** Lo que quien propone cree que es la versión vigente. Si no lo es, la orden se cae aquí. */
  readonly targetVersion: number;
  readonly proposedText: ConstitutionText;
  /** Padrón congelado del momento. Sin denominador fijo, «2/3 del censo» no es una afirmación. */
  readonly censusSize: number;
  /** El Círculo de Garantías del momento, que queda congelado en el evento. */
  readonly guarantors: readonly MemberId[];
  readonly calendar: ReformCalendar;
  readonly sponsorCount: number;
  readonly deliberationOpensAt: Instant;
  readonly deliberationClosesAt: Instant;
}

/**
 * Abre una reforma y **congela** en el evento todo lo que va a juzgarla.
 *
 * Los requisitos no los aporta quien llama: los copia la orden del texto vigente. Si los aportara,
 * la reforma elegiría el umbral con el que se la mide. Y aun así el pliegue los vuelve a cotejar,
 * porque este evento también puede llegar por otro camino.
 */
export async function openReform(
  log: ConstitutionLog,
  meta: ConstitutionCommandMeta,
  input: OpenReformInput,
): Promise<ConstitutionLog> {
  authorize(meta.actor, 'constitution:propose-reform', { kind: 'constitution' });
  const author = requireIdentity(meta);
  const state = replayConstitution(log);
  const text = requireText(state);
  const frozen: FrozenReformRules = {
    requirements: requirementsFor(text, input.kind),
    censusSize: input.censusSize,
    guarantors: input.guarantors,
    calendar: input.calendar,
  };
  return emit(log, state, state.constitutionId, meta, author, {
    type: 'ReformOpened',
    reformId: input.reformId,
    kind: input.kind,
    targetVersion: input.targetVersion,
    proposedText: input.proposedText,
    frozen,
    sponsorCount: input.sponsorCount,
    deliberationOpensAt: input.deliberationOpensAt,
    deliberationClosesAt: input.deliberationClosesAt,
  });
}

export interface RecordReformVoteInput {
  readonly reformId: ReformId;
  readonly vote: ReformVote;
}

/**
 * Registra el resultado de una votación de reforma, ya cerrada.
 *
 * Este agregado **no cuenta votos**: el conteo es del motor de decisiones y el `decisionId` permite
 * recomputarlo. Aquí sólo se comprueba que el resultado alcance el umbral **de la copia congelada**
 * y que la votación no haya caído en una ventana vedada.
 */
export async function recordReformVote(
  log: ConstitutionLog,
  meta: ConstitutionCommandMeta,
  input: RecordReformVoteInput,
): Promise<ConstitutionLog> {
  authorize(meta.actor, 'constitution:record-vote', { kind: 'constitution' });
  const author = requireIdentity(meta);
  const state = replayConstitution(log);
  return emit(log, state, state.constitutionId, meta, author, {
    type: 'ReformVoteRecorded',
    reformId: input.reformId,
    vote: input.vote,
  });
}

export interface ApproveReformInput {
  readonly reformId: ReformId;
}

/**
 * Una de las M aprobaciones de Garantías. **No es una firma criptográfica**: ver la cabecera.
 *
 * Quien aprueba es siempre quien actúa; no se aprueba en nombre de otra persona, y la matriz de
 * autorización lo comprueba con `subjectOnly` además de que lo compruebe el pliegue.
 */
export async function approveReform(
  log: ConstitutionLog,
  meta: ConstitutionCommandMeta,
  input: ApproveReformInput,
): Promise<ConstitutionLog> {
  const author = requireIdentity(meta);
  authorize(meta.actor, 'constitution:approve', { kind: 'constitution', subject: author });
  const state = replayConstitution(log);
  return emit(log, state, state.constitutionId, meta, author, {
    type: 'ReformApprovedByGuarantor',
    reformId: input.reformId,
    guarantorId: author,
  });
}

export interface RatifyReformInput {
  readonly reformId: ReformId;
  /** Cuándo entra en vigor. Nunca antes de la espera del §6.4 ni antes de este mismo acto. */
  readonly effectiveAt: Instant;
}

/** Pone la reforma en vigor: crea la versión nueva y conserva **todas** las anteriores. */
export async function ratifyReform(
  log: ConstitutionLog,
  meta: ConstitutionCommandMeta,
  input: RatifyReformInput,
): Promise<ConstitutionLog> {
  authorize(meta.actor, 'constitution:ratify', { kind: 'constitution' });
  const author = requireIdentity(meta);
  const state = replayConstitution(log);
  return emit(log, state, state.constitutionId, meta, author, {
    type: 'ReformRatified',
    reformId: input.reformId,
    version: state.currentVersion + 1,
    effectiveAt: input.effectiveAt,
  });
}

export interface RejectReformInput {
  readonly reformId: ReformId;
  readonly reason: ReformRejectionReason;
}

/**
 * Cierra una reforma sin ratificarla, con un motivo **que el historial sostenga**.
 *
 * Comparte permiso con la ratificación porque son el mismo acto de procedimiento —declarar el
 * desenlace de la reforma— y la diferencia entre uno y otro no la decide quien lo escribe: la
 * decide el historial, que es lo que `applyConstitution` comprueba.
 */
export async function rejectReform(
  log: ConstitutionLog,
  meta: ConstitutionCommandMeta,
  input: RejectReformInput,
): Promise<ConstitutionLog> {
  authorize(meta.actor, 'constitution:ratify', { kind: 'constitution' });
  const author = requireIdentity(meta);
  const state = replayConstitution(log);
  return emit(log, state, state.constitutionId, meta, author, {
    type: 'ReformRejected',
    reformId: input.reformId,
    reason: input.reason,
  });
}

/** Si la votación de la reforma alcanzó los dos umbrales de su copia congelada. Para la interfaz. */
export function reformVotesPass(reform: ReformRecord): boolean {
  return (
    reform.votes.length === reform.frozen.requirements.votesRequired &&
    reform.votes.every((vote) => voteMeetsThresholds(vote, reform.frozen))
  );
}
