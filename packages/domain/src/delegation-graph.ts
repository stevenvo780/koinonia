/**
 * Grafo de delegación: ámbitos, vigencia, aristas, cadenas y ciclos (PARTE C.2–C.4).
 *
 * Este módulo no sabe nada de papeletas ni de escrutinio: sólo resuelve **quién delega en quién**
 * para un instante y un ámbito dados, y recorre las cadenas que resultan. `delegation.ts` lo usa
 * para producir pesos; el motor lo usa para prevenir ciclos y saturación **al conceder**.
 *
 * ═══ Por qué la prevención de ciclos se hace sobre la UNIÓN de ámbitos ═══
 *
 * C.4.1 enuncia un teorema —«si el grafo no tiene ciclos y sólo se añaden aristas de una en una,
 * todo ciclo nuevo contiene la arista recién añadida»— y deriva de él una prevención que declara
 * **completa**, comprobando alcanzabilidad «para cada ámbito efectivo tocado por `d`» con una arista
 * por `(nodo, ámbito)`.
 *
 * Esa prevención **no es completa**, y el contraejemplo es de dos aristas: Ana delega en Beto con
 * ámbito `global`; Beto delega en Ana con ámbito `topic: T`. Ningún ámbito tomado por separado tiene
 * ciclo. Pero en una decisión cuyos `topics` contienen `T`, la arista de Ana es la global (es su
 * única delegación que casa) y la de Beto es la de tema (gana por especificidad): el grafo
 * **efectivo** de esa decisión es `Ana → Beto → Ana`, un ciclo. La resolución por especificidad
 * (C.2) mezcla ámbitos dentro de un mismo grafo, así que comprobar los ámbitos por separado deja
 * pasar exactamente esa familia de ciclos. Reportado como errata E-37.
 *
 * Aquí la prevención se hace sobre el grafo **unión** —toda arista vigente, sea cual sea su ámbito—,
 * que es un supergrafo de todo grafo efectivo posible. Si el delegante no es alcanzable desde el
 * delegado en la unión, no lo es en ninguna decisión, hoy ni dentro de seis meses. La prevención
 * vuelve a ser completa, al precio de rechazar alguna concesión que en la práctica nunca habría
 * ciclado. Se acepta ese precio porque las dos consecuencias no son simétricas: un rechazo al
 * conceder es un mensaje inmediato y accionable («delegá en otra persona»), mientras que un ciclo no
 * detectado es **silencio** en el escrutinio (C.4.b) para todos los implicados y para todos los que
 * desembocan en ellos, descubierto cuando ya no se puede votar.
 *
 * La red de seguridad del escrutinio se conserva igualmente (C.4.a): un log fabricado a mano puede
 * contener ciclos que ninguna orden habría aceptado.
 */

import type { Delegation, DelegationScope } from './config.js';
import { type CircleId, compareIds, type Instant, type MemberId, type TopicId } from './ids.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Ámbitos (C.1, C.2)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Lo mínimo de una decisión contra lo que se resuelve un ámbito. `DecisionConfig` lo satisface
 * estructuralmente; los tests lo construyen a mano sin congelar un padrón.
 */
export interface ScopeSubject {
  readonly circleId: CircleId;
  readonly topics: readonly TopicId[];
}

/** Especificidad del ámbito (C.1). Crece hacia abajo: `global` 0 < `circle` 1 < `topic` 2. */
export function scopeSpecificity(scope: DelegationScope): 0 | 1 | 2 {
  switch (scope.kind) {
    case 'global':
      return 0;
    case 'circle':
      return 1;
    case 'topic':
      return 2;
  }
}

/**
 * Clave canónica del ámbito. Dos delegaciones del mismo delegante con la misma clave son la misma
 * «casilla» y no pueden estar activas a la vez (C.1.b).
 */
export function scopeKey(scope: DelegationScope): string {
  switch (scope.kind) {
    case 'global':
      return 'global';
    case 'circle':
      return `circle:${scope.circleId}`;
    case 'topic':
      return `topic:${scope.topicId}`;
  }
}

/**
 * `matches(scope, D)` de C.2. El tema casa por **pertenencia al conjunto** `D.topics`, no por
 * igualdad con `D.topics[0]`: ese es el fallo ingenuo que INV-30 describe.
 */
export function matchesScope(scope: DelegationScope, subject: ScopeSubject): boolean {
  switch (scope.kind) {
    case 'global':
      return true;
    case 'circle':
      return subject.circleId === scope.circleId;
    case 'topic':
      return subject.topics.includes(scope.topicId);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Vigencia (C.2)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Vigencia pura, sin mirar el ámbito:
 *
 * ```
 * d.grantedAt < t                                (estrictamente anterior)
 * ∧ (d.revokedAt === undefined ∨ t < d.revokedAt) (la revocación es INMEDIATA — INV-24)
 * ∧ t < d.expiresAt                               (la caducidad también — INV-29)
 * ```
 *
 * Los tres signos son estrictos y los tres importan en la frontera: revocar en `closedAt` exacto
 * **sí** deja fuera la delegación, y caducar en `closedAt` exacto también. Es la misma convención
 * que D.3.b para las papeletas (`castAt < closesAt`): el instante de cierre pertenece siempre al
 * después.
 */
export function isVigent(delegation: Delegation, at: Instant): boolean {
  if (delegation.grantedAt >= at) return false;
  if (delegation.revokedAt !== undefined && at >= delegation.revokedAt) return false;
  return at < delegation.expiresAt;
}

/**
 * El primer instante en que una delegación está vigente.
 *
 * C.2 exige `d.grantedAt < t` **estrictamente**, así que en su propio `grantedAt` una delegación
 * todavía no cuenta: sólo cuenta desde el milisegundo siguiente. Toda comprobación EX ANTE —ciclo y
 * tope— tiene que hacerse en ese instante y no en `grantedAt`, porque la pregunta que se responde
 * es «¿qué pasaría **una vez concedida**?». Evaluarla en `grantedAt` deja fuera la propia arista que
 * se está juzgando, y también cualquier otra concedida en el mismo milisegundo (dos eventos pueden
 * compartir `occurredAt`; lo que nunca comparten es `seq`).
 */
export function firstActiveInstant(delegation: Delegation): Instant {
  return (delegation.grantedAt + 1) as Instant;
}

/** Vigencia **y** ámbito: la condición completa de C.2 para una decisión concreta. */
export function isDelegationActive(
  delegation: Delegation,
  at: Instant,
  subject: ScopeSubject,
): boolean {
  return isVigent(delegation, at) && matchesScope(delegation.scope, subject);
}

/**
 * Orden de selección de C.2: **especificidad primero, recencia después**. El tercer criterio
 * (`delegationId` ascendente) no está en la especificación y nunca se alcanza en un log legal, donde
 * `grantedSeq` es único; existe para que el orden sea **total** también sobre datos fabricados a
 * mano, y así `resolveDelegation` no pueda depender del orden de un `Array.prototype.sort` inestable.
 */
export function compareDelegationPriority(a: Delegation, b: Delegation): number {
  const bySpecificity = scopeSpecificity(b.scope) - scopeSpecificity(a.scope);
  if (bySpecificity !== 0) return bySpecificity;
  if (a.grantedSeq !== b.grantedSeq) return b.grantedSeq - a.grantedSeq;
  return compareIds(a.delegationId, b.delegationId);
}

/** La delegación que gobierna a `delegator` en `at` para `subject`, si hay alguna (C.2). */
export function selectActiveDelegation(
  delegations: readonly Delegation[],
  delegator: MemberId,
  at: Instant,
  subject: ScopeSubject,
): Delegation | undefined {
  const active = delegations.filter(
    (d) => d.delegator === delegator && isDelegationActive(d, at, subject),
  );
  if (active.length === 0) return undefined;
  return [...active].sort(compareDelegationPriority)[0];
}

/** La delegación vigente del mismo `(delegante, ámbito)`, que una concesión nueva desplaza (C.1.b). */
export function findSupersededDelegation(
  delegations: readonly Delegation[],
  candidate: Delegation,
): Delegation | undefined {
  const key = scopeKey(candidate.scope);
  return delegations.find(
    (d) =>
      d.delegationId !== candidate.delegationId &&
      d.delegator === candidate.delegator &&
      scopeKey(d.scope) === key &&
      isVigent(d, candidate.grantedAt),
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Cadenas (C.3 PASO 3, C.4)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Por qué el peso de un miembro no llegó a ninguna papeleta. Alimenta el aviso de C.4.3. */
export type UnassignedReason =
  | 'no-delegation'
  | 'delegate-outside-census'
  | 'chain-dead-end'
  | 'depth-exceeded'
  | 'cycle'
  | 'cap-returned';

export type ChainOutcome =
  | { readonly kind: 'assigned'; readonly terminal: MemberId; readonly hops: number }
  | { readonly kind: 'unassigned'; readonly reason: UnassignedReason; readonly hops: number };

/**
 * PASO 3 de C.3, literal.
 *
 * `hops` cuenta **aristas**, no nodos: `maxDepth = 4` admite `vos → Ana → Beto → Clara → Diego` y
 * rechaza el quinto salto. Contar nodos es el error de ±1 sistemático que INV-26 describe.
 *
 * Al excederse la profundidad o al morder la cola, el peso **no se deposita en ningún sitio**
 * (C.4.b, C.4.c): ni en el último nodo válido —sería entregar poder a alguien que el delegante no
 * eligió— ni repartido entre los miembros del ciclo —sería fabricar una preferencia que nadie
 * expresó—. El silencio es la única lectura fiel y la única neutral.
 */
export function walkChain(
  start: MemberId,
  edgeOf: (member: MemberId) => MemberId | undefined,
  votedDirect: (member: MemberId) => boolean,
  maxDepth: number,
): ChainOutcome {
  // Regla de oro 1: quien votó directo es terminal de sí mismo y no reenvía nada.
  if (votedDirect(start)) return { kind: 'assigned', terminal: start, hops: 0 };

  const seen = new Set<MemberId>([start]);
  let current = start;
  let hops = 0;

  for (;;) {
    const next = edgeOf(current);
    if (next === undefined) {
      return {
        kind: 'unassigned',
        reason: hops === 0 ? 'no-delegation' : 'chain-dead-end',
        hops,
      };
    }
    hops += 1;
    if (hops > maxDepth) return { kind: 'unassigned', reason: 'depth-exceeded', hops };
    if (seen.has(next)) return { kind: 'unassigned', reason: 'cycle', hops };
    seen.add(next);
    current = next;
    if (votedDirect(current)) return { kind: 'assigned', terminal: current, hops };
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Grafo unión y comprobaciones EX ANTE (C.4.1, C.5.b.1)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Aristas vigentes de **todos** los ámbitos a la vez. Un nodo puede tener varias salidas (una por
 * ámbito): es un supergrafo de cualquier grafo efectivo. Ver la cabecera del módulo.
 */
export function unionEdges(
  delegations: readonly Delegation[],
  at: Instant,
): ReadonlyMap<MemberId, readonly MemberId[]> {
  const edges = new Map<MemberId, MemberId[]>();
  for (const delegation of delegations) {
    if (!isVigent(delegation, at)) continue;
    const out = edges.get(delegation.delegator);
    if (out === undefined) edges.set(delegation.delegator, [delegation.delegate]);
    else if (!out.includes(delegation.delegate)) out.push(delegation.delegate);
  }
  return edges;
}

/** Aristas invertidas (delegado → quienes le delegan) del grafo unión. */
function reverseUnionEdges(
  delegations: readonly Delegation[],
  at: Instant,
): ReadonlyMap<MemberId, readonly MemberId[]> {
  const reverse = new Map<MemberId, MemberId[]>();
  for (const delegation of delegations) {
    if (!isVigent(delegation, at)) continue;
    const incoming = reverse.get(delegation.delegate);
    if (incoming === undefined) reverse.set(delegation.delegate, [delegation.delegator]);
    else if (!incoming.includes(delegation.delegator)) incoming.push(delegation.delegator);
  }
  return reverse;
}

/**
 * ¿`target` es alcanzable desde `from` en el grafo unión?
 *
 * Recorrido **iterativo** con conjunto `seen`. El fallo ingenuo de INV-25 —recursión sin `seen`— no
 * es sólo un desbordamiento de pila: es una denegación de servicio de dos eventos (A→B, B→A).
 */
export function reachesInUnion(
  delegations: readonly Delegation[],
  from: MemberId,
  target: MemberId,
  at: Instant,
): boolean {
  if (from === target) return true;
  const edges = unionEdges(delegations, at);
  const seen = new Set<MemberId>([from]);
  const pending: MemberId[] = [from];
  for (;;) {
    const current = pending.pop();
    if (current === undefined) return false;
    for (const next of edges.get(current) ?? []) {
      if (next === target) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      pending.push(next);
    }
  }
}

/**
 * C.4.1 — ¿conceder `candidate` cerraría un ciclo? Se ejecuta **al conceder**, no al escrutar.
 *
 * `candidate` no debe estar en `delegations`: se pregunta si el delegante ya es alcanzable desde el
 * delegado **antes** de añadir la arista. La autodelegación (`delegate === delegator`) es el caso
 * degenerado y devuelve `true`.
 */
export function wouldCreateCycle(
  delegations: readonly Delegation[],
  candidate: Delegation,
): boolean {
  return reachesInUnion(
    delegations,
    candidate.delegate,
    candidate.delegator,
    firstActiveInstant(candidate),
  );
}

/**
 * C.5.b.1 — personas que **podrían** acabar representadas por `delegate` en alguna decisión, con las
 * delegaciones vigentes en `at` y sin que nadie vote directo. Es la proyección transitiva del tope.
 *
 * Es una cota superior deliberada: se recorre el grafo unión, así que cuenta a quien llegaría a
 * `delegate` en *alguna* combinación de círculo y temas. Un tope que sólo mira las delegaciones
 * directas es exactamente el fallo ingenuo de INV-27; un tope que sólo mira la decisión de hoy
 * dejaría pasar la saturación de mañana, y el tope se comprueba una vez, al conceder.
 *
 * No incluye a `delegate`. El peso proyectado es `1 + resultado.length`.
 */
export function projectedRepresented(
  delegations: readonly Delegation[],
  delegate: MemberId,
  at: Instant,
  maxDepth: number,
): readonly MemberId[] {
  const reverse = reverseUnionEdges(delegations, at);
  const seen = new Set<MemberId>([delegate]);
  let frontier: MemberId[] = [delegate];
  const found: MemberId[] = [];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: MemberId[] = [];
    for (const node of frontier) {
      for (const delegator of reverse.get(node) ?? []) {
        if (seen.has(delegator)) continue;
        seen.add(delegator);
        found.push(delegator);
        next.push(delegator);
      }
    }
    frontier = next;
  }
  return found.sort(compareIds);
}
