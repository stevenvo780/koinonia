/**
 * Máquina de estados de una decisión (A.8).
 *
 * ```
 *   Draft ──open()──▶ Open ──close()──▶ Closed ──ratify()──▶ Ratified
 *     │                 │                 │  └──reject()───▶ Rejected
 *     └─annul()─────────┴─────────────────┴──annul()──────▶ Annulled
 * ```
 *
 * ═══ La tabla es un dato, no una cadena de `if` ═══
 *
 * INV-34 exige recorrer el producto cartesiano completo `Estado × TipoEvento` y comprobar que **toda**
 * combinación ausente de la tabla lanza `IllegalTransitionError` dejando el estado intacto. Ese test
 * es escribible porque la tabla es un valor enumerable. El fallo ingenuo que INV-34 describe —«un
 * `switch` sobre el tipo de evento sin mirar el estado, o un `default:` que ignora en silencio»— es
 * literalmente inexpresable aquí: si una pareja no está en `TRANSITIONS`, no existe.
 *
 * ═══ Las prohibiciones que importan (A.8.2) ═══
 *
 *  1. `Closed → Open` **nunca**. Reabrir una urna cuyo marcador ya se conoce destruye el secreto del
 *     voto y habilita el ataque de «votar hasta que gane mi lado». Corregir exige una decisión nueva
 *     con `supersedes`.
 *  2. `Ratified | Rejected | Annulled` son **absorbentes**. Ni siquiera `Annulled → Ratified` «para
 *     corregir un error»: toda corrección es una decisión nueva que deroga la anterior (INV-36).
 *  3. Nada de saltarse el escrutinio: `Draft → Closed`, `Draft → Ratified`, `Open → Ratified`.
 *  4. `BallotCast` sólo en `Open`.
 *  6. `DecisionOpened` dos veces (recongelar el padrón) es imposible porque `Open` no acepta
 *     `DecisionOpened`.
 *
 * ═══ Dos precisiones sobre la tabla de A.8.1 ═══
 *
 * DECISIÓN: A.8.1 no contiene ninguna fila para `DecisionDrafted`, pero A.7 lo lista como evento y el
 * log tiene que empezar por algún lado. Se modela un pseudo-estado `Inexistent`, previo a `Draft`,
 * cuyo único evento legal es `DecisionDrafted`. Así el log completo sigue siendo una secuencia de
 * transiciones y no hay un «evento fundacional» con reglas aparte. Reportado como hueco de la spec.
 *
 * DECISIÓN: A.8.1 tampoco ubica `BallotVoided`. Se admite **sólo en `Open`**. Admitirlo en `Closed`
 * contradiría frontalmente INV-35 («una propuesta cerrada no muta»: `effectiveBallots` idénticas
 * antes y después del cierre). Un voto fraudulento descubierto tras el cierre se trata por la vía que
 * A.8.1 ya prevé —impugnación admitida ⇒ `DecisionAnnulled`—, que además es la vía políticamente
 * visible que A.2 exige para anular un voto. Reportado como hueco de la spec.
 */

import { IllegalTransitionError } from './errors.js';

/** Los seis estados públicos de A.8. */
export type DecisionStatus = 'Draft' | 'Open' | 'Closed' | 'Ratified' | 'Rejected' | 'Annulled';

/** Pseudo-estado previo a `Draft`: la decisión todavía no existe. */
export type LifecycleStatus = 'Inexistent' | DecisionStatus;

export const DECISION_STATUSES: readonly DecisionStatus[] = [
  'Draft',
  'Open',
  'Closed',
  'Ratified',
  'Rejected',
  'Annulled',
];

export const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = ['Inexistent', ...DECISION_STATUSES];

/** Los 19 tipos de evento de A.7. */
export type DecisionEventType =
  | 'DecisionDrafted'
  | 'DecisionOpened'
  | 'BallotCast'
  | 'BallotVoided'
  | 'DelegationGranted'
  | 'DelegationRevoked'
  | 'ObjectionRaised'
  | 'ObjectionAdmitted'
  | 'ObjectionDismissed'
  | 'ObjectionIntegrated'
  | 'ObjectionWithdrawn'
  | 'RoundOpened'
  | 'WindowExtended'
  | 'SeedRevealed'
  | 'DecisionClosed'
  | 'ResultComputed'
  | 'DecisionRatified'
  | 'DecisionRejected'
  | 'DecisionAnnulled';

export const DECISION_EVENT_TYPES: readonly DecisionEventType[] = [
  'DecisionDrafted',
  'DecisionOpened',
  'BallotCast',
  'BallotVoided',
  'DelegationGranted',
  'DelegationRevoked',
  'ObjectionRaised',
  'ObjectionAdmitted',
  'ObjectionDismissed',
  'ObjectionIntegrated',
  'ObjectionWithdrawn',
  'RoundOpened',
  'WindowExtended',
  'SeedRevealed',
  'DecisionClosed',
  'ResultComputed',
  'DecisionRatified',
  'DecisionRejected',
  'DecisionAnnulled',
];

export interface Transition {
  readonly from: LifecycleStatus;
  readonly event: DecisionEventType;
  readonly to: DecisionStatus;
  /** Precondición normativa que además debe comprobarse (referencia a la spec). */
  readonly note: string;
}

/**
 * La tabla A.8.1, completa y como dato. Todo lo que no esté aquí es ilegal por construcción.
 */
export const TRANSITIONS: readonly Transition[] = [
  { from: 'Inexistent', event: 'DecisionDrafted', to: 'Draft', note: 'crea el agregado' },

  { from: 'Draft', event: 'DecisionOpened', to: 'Open', note: 'A.8.1: congela el padrón' },
  { from: 'Draft', event: 'DecisionAnnulled', to: 'Annulled', note: 'A.8.1: autoría' },

  { from: 'Open', event: 'BallotCast', to: 'Open', note: 'D.3' },
  {
    from: 'Open',
    event: 'BallotVoided',
    to: 'Open',
    note: 'A.2: acto público motivado + 2 firmas',
  },
  { from: 'Open', event: 'DelegationGranted', to: 'Open', note: 'PARTE C' },
  { from: 'Open', event: 'DelegationRevoked', to: 'Open', note: 'PARTE C' },
  { from: 'Open', event: 'ObjectionRaised', to: 'Open', note: 'B.3' },
  { from: 'Open', event: 'ObjectionAdmitted', to: 'Open', note: 'B.3.a' },
  { from: 'Open', event: 'ObjectionDismissed', to: 'Open', note: 'B.3.a: panel, 2/3, motivado' },
  { from: 'Open', event: 'ObjectionIntegrated', to: 'Open', note: 'B.3.b: firma del objetante' },
  { from: 'Open', event: 'ObjectionWithdrawn', to: 'Open', note: 'B.3.b: retirada tácita' },
  { from: 'Open', event: 'RoundOpened', to: 'Open', note: 'A.8.1: round ≤ maxRounds' },
  { from: 'Open', event: 'WindowExtended', to: 'Open', note: 'A.11: prórroga dentro de Open' },
  { from: 'Open', event: 'DecisionClosed', to: 'Closed', note: 'D.2: tick atómico' },
  { from: 'Open', event: 'DecisionAnnulled', to: 'Annulled', note: 'vicio grave + 2 firmas' },

  { from: 'Closed', event: 'SeedRevealed', to: 'Closed', note: 'sha256(seed) === commitment' },
  { from: 'Closed', event: 'ResultComputed', to: 'Closed', note: 'A.8' },
  { from: 'Closed', event: 'DecisionRatified', to: 'Ratified', note: 'tras challengeWindow' },
  {
    from: 'Closed',
    event: 'DecisionRejected',
    to: 'Rejected',
    note: 'umbral | quórum | objeciones',
  },
  {
    from: 'Closed',
    event: 'DecisionAnnulled',
    to: 'Annulled',
    note: 'impugnación | hash discrepante',
  },
];

const INDEX = new Map<string, DecisionStatus>(
  TRANSITIONS.map((t) => [`${t.from}\u0000${t.event}`, t.to]),
);

/** Estados terminales: absorbentes, sin excepciones (INV-36). */
export const TERMINAL_STATUSES: readonly DecisionStatus[] = ['Ratified', 'Rejected', 'Annulled'];

export function isTerminal(status: LifecycleStatus): boolean {
  return status === 'Ratified' || status === 'Rejected' || status === 'Annulled';
}

export function isLegalTransition(from: LifecycleStatus, event: DecisionEventType): boolean {
  return INDEX.has(`${from}\u0000${event}`);
}

/** Estado destino, o `undefined` si la pareja no está en la tabla. */
export function peekTransition(
  from: LifecycleStatus,
  event: DecisionEventType,
): DecisionStatus | undefined {
  return INDEX.get(`${from}\u0000${event}`);
}

/**
 * Aplica la transición o lanza. Es la **única** puerta por la que un evento puede cambiar el estado:
 * si esto lanza, el estado del llamante queda intacto porque nunca se llegó a construir uno nuevo.
 */
export function nextStatus(from: LifecycleStatus, event: DecisionEventType): DecisionStatus {
  const to = peekTransition(from, event);
  if (to === undefined) {
    throw new IllegalTransitionError(
      from,
      event,
      isTerminal(from)
        ? 'los estados terminales son absorbentes: toda corrección es una decisión nueva (A.8.2.2)'
        : 'la pareja (estado, evento) no está en la tabla A.8.1',
    );
  }
  return to;
}

/** Todas las transiciones legales desde un estado. Para la interfaz y para los tests exhaustivos. */
export function legalEventsFrom(from: LifecycleStatus): readonly DecisionEventType[] {
  return TRANSITIONS.filter((t) => t.from === from).map((t) => t.event);
}
