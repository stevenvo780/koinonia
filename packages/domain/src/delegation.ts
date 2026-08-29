/**
 * Democracia líquida — resolución de pesos (PARTE C.3, C.4.3 y C.5).
 *
 * > «Es la parte más peligrosa del sistema. Una delegación mal modelada no produce un error visible:
 * > produce un resultado **plausible y falso**, con votos que nadie emitió y poder que nadie
 * > confirió.» (cabecera de la PARTE C)
 *
 * De ahí que todo lo que sigue esté escrito en el orden exacto que la especificación fija y no en el
 * que resultaría cómodo. El orden **es** la semántica:
 *
 *  1. papeletas directas (el voto directo gana SIEMPRE, sin mirar instantes relativos);
 *  2. aristas del grafo efectivo en `closedAt`;
 *  3. recorrido de cadenas con detección de ciclo y de profundidad;
 *  4. agregación de pesos;
 *  5. tope de concentración, LIFO por `grantedSeq`;
 *  6. `EffectiveBallot[]` en orden de padrón.
 *
 * Invertir 1 y 2 —resolver delegaciones antes que papeletas— produce el fallo que INV-23 describe:
 * el peso del delegante se cuenta en la papeleta del delegado **y** en la suya.
 *
 * ═══ El tiempo entra como dato ═══
 *
 * El instante de resolución es `closedAt` (C.2.b), el cierre REAL tras prórrogas, y lo recibe la
 * función. No hay ningún reloj aquí. Por eso «revocable en cualquier momento con efecto inmediato»
 * es literalmente verdadero: una revocación un milisegundo antes del cierre cambia el resultado, sin
 * que ninguna caché de grafo pueda quedarse obsoleta (el fallo ingenuo de INV-24).
 */

import type { Ballot } from './ballot.js';
import type { Delegation, DecisionConfig } from './config.js';
import {
  compareDelegationPriority,
  findSupersededDelegation,
  firstActiveInstant,
  projectedRepresented,
  type ScopeSubject,
  scopeKey,
  type UnassignedReason,
  isDelegationActive,
  isVigent,
  walkChain,
  wouldCreateCycle,
} from './delegation-graph.js';
import { PreconditionError } from './errors.js';
import {
  compareIds,
  type DelegationId,
  type Instant,
  instant,
  type MemberId,
  sortIds,
} from './ids.js';
import { directWeightResolver, type EffectiveBallot, type WeightResolver } from './tally/common.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Tope de concentración (C.5)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `capWeight = ⌊ cap.num × N / cap.den ⌋`, con `N` el CENSO (C.5.a) y `cap` por defecto `1/10`
 * ⇒ 30 de 300, que es el «tope de 30 votos por persona» de `GOVERNANCE.md` §5.
 *
 * Aritmética entera con `bigint`: `cap` es una `Fraction` y el suelo se toma por división entera, no
 * por `Math.floor` de un cociente en coma flotante (ADR-0027).
 *
 * **El suelo del suelo es 1.** `INV-27` exige `b.weight ≤ capWeight` para TODA papeleta efectiva,
 * pero el peso propio vale 1 y no es devolvible: con `N = 5` y `cap = 1/10` saldría `capWeight = 0`
 * y el invariante sería insatisfacible para cualquier votante, delegue o no. La configuración ya
 * rechaza esa combinación al abrir (`validateDecisionConfig`); aquí se protege el escrutinio de un
 * `configHash` fabricado a mano. Reportado como errata E-40.
 */
export function capWeight(config: DecisionConfig): number {
  const census = BigInt(config.electorate.censusSize);
  const { num, den } = config.delegation.cap;
  const floor = (num * census) / den;
  // `floor < 1n` y `floor <= 1n` dan el MISMO resultado para todo `floor` entero no negativo: en
  // `floor === 1n` la primera cae al `else` y devuelve `Number(1n)`, que también es `1`. Las dos
  // ramas convergen exactamente en el único punto donde discreparían. Mutante demostrado
  // equivalente (§10, mutación sobre `delegacion`), no deuda de prueba.
  return floor < 1n ? 1 : Number(floor);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Resolución
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Un delegante y la papeleta en la que su peso acabó depositado. */
export interface DelegationAssignment {
  readonly delegator: MemberId;
  /** Votante terminal: quien emitió la papeleta que lleva este peso. */
  readonly terminal: MemberId;
  /** Aristas recorridas. `1 ≤ hops ≤ maxDepth`. */
  readonly hops: number;
  /** La delegación que el propio delegante concedió. Es la unidad de devolución LIFO (C.5.b.2). */
  readonly via: DelegationId;
  readonly viaSeq: number;
}

export interface UnassignedMember {
  readonly member: MemberId;
  readonly reason: UnassignedReason;
}

export interface DelegationResolution {
  /** Instante de resolución: `closedAt` (C.2.b). */
  readonly at: Instant;
  readonly capWeight: number;
  /** Grafo efectivo: delegante → delegado. Una arista por delegante, la de C.2. */
  readonly edges: ReadonlyMap<MemberId, MemberId>;
  /** Delegantes cuyo peso llegó a una papeleta. Nunca contiene a un votante directo. */
  readonly assignments: readonly DelegationAssignment[];
  /** Miembros cuyo peso quedó en silencio, en orden de padrón. Alimenta el aviso de C.4.3. */
  readonly unassigned: readonly UnassignedMember[];
  /** Peso final por votante directo. Entero ≥ 1 (B.0.a). */
  readonly weightOf: ReadonlyMap<MemberId, number>;
  /** Representados por cada votante, ordenado. Nunca incluye al propio votante. */
  readonly onBehalfOf: ReadonlyMap<MemberId, readonly MemberId[]>;
  /** Delegantes cuyo peso se devolvió por tope, en el orden LIFO en que se devolvieron. */
  readonly returnedByCap: readonly MemberId[];
  /** C.4.b: si esto no está vacío, el grafo tenía un ciclo y hay que declararlo en la `Proof`. */
  readonly cycleMembers: readonly MemberId[];
}

/**
 * `resolveWeights` de C.3.
 *
 * `ballots` son las papeletas que el escrutinio ya declaró utilizables (`lastBallotPerVoter` sobre
 * las válidas y no anuladas). El PASO 1 vuelve a filtrar por padrón, ronda, versión de la propuesta
 * e instante: no es defensa redundante sino la misma razón por la que `effectiveBallots` filtra —un
 * log manipulado a mano no debe poder colar un voto en el escrutinio (INV-01)—.
 */
export function resolveDelegation(
  config: DecisionConfig,
  ballots: readonly Ballot[],
  delegations: readonly Delegation[],
  closedAt: Instant,
): DelegationResolution {
  const members = config.electorate.members;
  const census = new Set<MemberId>(members.map((m) => m.memberId));
  const subject: ScopeSubject = { circleId: config.circleId, topics: config.topics };
  const maxDepth = config.delegation.maxDepth;
  const cap = capWeight(config);

  // ── PASO 1: papeletas directas. El voto directo SIEMPRE gana ────────────────────────────────
  //
  // De los cuatro filtros que enumera C.3 se aplican aquí los dos que esta función puede aplicar:
  // pertenencia al padrón (INV-02) e instante de emisión anterior al cierre (D.3.b). Los otros dos
  // —`b.round !== cfg.currentRound` y `b.proposalVersionHash !== cfg.proposalVersionHash`— NO son
  // comprobables desde `DecisionConfig`: `currentRound` no existe en la configuración (la ronda vive
  // en el log, la mueve `RoundOpened`) y `cfg.proposalVersionHash` es el hash congelado AL ABRIR,
  // que B.3.b cambia con cada `ObjectionIntegrated`. Aplicar el segundo literalmente descartaría
  // todas las papeletas válidas de la ronda 2 en adelante. Los dos ya los aplicó `isBallotValid`
  // con el contexto correcto, aguas arriba. Reportado como errata E-38.
  const direct = new Map<MemberId, Ballot>();
  for (const ballot of ballots) {
    if (!census.has(ballot.voter)) continue; // INV-02: inelegible nunca cuenta.
    if (ballot.castAt >= closedAt) continue; // D.3.b: el cierre pertenece al después.
    const previous = direct.get(ballot.voter);
    // El criterio de desempate (`seq` mayor) protege contra un log fabricado con dos papeletas
    // directas del mismo votante — la misma defensa redundante que los dos filtros de arriba. Pero
    // a partir de acá `direct` sólo se vuelve a leer con `.has(...)` (PASO 2, PASO 3): la papeleta
    // CONCRETA que queda guardada nunca se vuelve a mirar, sólo si HAY alguna. El desempate no tiene
    // ningún efecto observable en `DelegationResolution` ni en `EffectiveBallot[]` —que emite una
    // entrada por papeleta de ENTRADA, no por votante—; mutar `>` a `>=`, `<=` o la condición entera
    // no cambia ninguna salida pública. Mutante demostrado equivalente (§10), no deuda de prueba.
    if (previous === undefined || ballot.seq > previous.seq) direct.set(ballot.voter, ballot);
  }

  // ── PASO 2: grafo de delegación efectivo en `closedAt` ──────────────────────────────────────
  const edges = new Map<MemberId, MemberId>();
  const deadEdge = new Set<MemberId>();
  const chosenBy = new Map<MemberId, Delegation>();
  for (const member of members) {
    // Regla de oro: quien votó directo no delega, aunque tenga delegación vigente (INV-23).
    if (direct.has(member.memberId)) continue;
    const active = delegations.filter(
      (d) => d.delegator === member.memberId && isDelegationActive(d, closedAt, subject),
    );
    // Las dos líneas siguientes se defienden MUTUAMENTE: si `active` está vacío, `[0]` de un
    // arreglo vacío ya da `undefined` y la de abajo lo atrapa igual; si `active` no está vacío,
    // `[0]` de un `sort` sobre un arreglo no vacío nunca es `undefined`. Quitar cualquiera de las
    // dos deja a la otra cubriendo exactamente el mismo caso: son dos guardas para el mismo hecho,
    // no dos hechos distintos. Mutante demostrado equivalente (§10), no deuda de prueba.
    if (active.length === 0) continue;
    const chosen = [...active].sort(compareDelegationPriority)[0];
    if (chosen === undefined) continue;
    if (!census.has(chosen.delegate)) {
      // Arista muerta: el delegado ya no está en el padrón congelado. C.4.3 lo distingue del
      // «no delegó» porque el mensaje que la persona necesita recibir es otro.
      deadEdge.add(member.memberId);
      continue;
    }
    edges.set(member.memberId, chosen.delegate);
    chosenBy.set(member.memberId, chosen);
  }

  // ── PASO 3: recorrido de cadenas, en orden de padrón ⇒ determinismo ─────────────────────────
  const assignments: DelegationAssignment[] = [];
  const unassigned: UnassignedMember[] = [];
  const cycleMembers: MemberId[] = [];

  for (const member of members) {
    const start = member.memberId;
    if (direct.has(start)) continue; // terminal de sí mismo: se contabiliza en el PASO 4.
    if (!edges.has(start)) {
      unassigned.push({
        member: start,
        reason: deadEdge.has(start) ? 'delegate-outside-census' : 'no-delegation',
      });
      continue;
    }
    const outcome = walkChain(
      start,
      (m) => edges.get(m),
      (m) => direct.has(m),
      maxDepth,
    );
    if (outcome.kind === 'unassigned') {
      unassigned.push({ member: start, reason: outcome.reason });
      if (outcome.reason === 'cycle') cycleMembers.push(start);
      continue;
    }
    const via = chosenBy.get(start);
    if (via === undefined) continue; // inalcanzable: hay arista ⇒ hay delegación elegida.
    assignments.push({
      delegator: start,
      terminal: outcome.terminal,
      hops: outcome.hops,
      via: via.delegationId,
      viaSeq: via.grantedSeq,
    });
  }

  // ── PASO 4: agregación de pesos ─────────────────────────────────────────────────────────────
  //  peso(v) = 1 (propio) + |{ d : assignedTo(d) = v, d ≠ v }|
  const weightOf = new Map<MemberId, number>();
  for (const voter of direct.keys()) weightOf.set(voter, 1);
  const carried = new Map<MemberId, DelegationAssignment[]>();
  for (const assignment of assignments) {
    weightOf.set(assignment.terminal, (weightOf.get(assignment.terminal) ?? 1) + 1);
    const bucket = carried.get(assignment.terminal);
    if (bucket === undefined) carried.set(assignment.terminal, [assignment]);
    else bucket.push(assignment);
  }

  // ── PASO 5: tope de concentración, determinista y LIFO por `grantedSeq` (C.5.b.2) ───────────
  //
  // ═══ Qué se devuelve exactamente: una PERSONA, no una arista ═══
  //
  // INV-28 dice que los devueltos «son exactamente las delegaciones de mayor `grantedSeq` hacia ese
  // delegado». En una estrella eso es unívoco. En una CADENA `A → B → C` con C votando, no lo es:
  // hacia C no hay dos delegaciones, hay una sola (`B → C`), y sin embargo C carga dos pesos, el de
  // B y el de A. La especificación no dice qué se devuelve. Errata E-44.
  //
  // Se devuelve **la unidad de peso de una persona**, ordenada por el `grantedSeq` de la delegación
  // que ESA persona concedió. Devolver a B deja a B en silencio y **no toca a A**, que sigue llegando
  // a C. La alternativa —romper la arista `B → C` y arrastrar con ella a todos los que venían
  // detrás— se descarta por tres razones, y las tres las argumenta la propia C.5:
  //  (a) *No es mínima.* Quitar una arista puede restar 2, 5 o 40 pesos de golpe y dejar al delegado
  //      muy por debajo del tope. El tope pide recortar el exceso, no arrasar la rama.
  //  (b) *Castiga a quien no hizo nada.* A delegó hace meses en B y confió; el exceso lo produjo B
  //      al delegar tarde. C.5.b.2 rechaza exactamente ese reparto de la culpa cuando descarta FIFO
  //      («castigaría a quien delegó hace meses y confió, lo cual es arbitrario»).
  //  (c) *Cascadea.* Es el vicio que C.5.1 le imputa a la política (c) de prorrateo: «puede
  //      cascadear […] y exige una recursión con su propio criterio de terminación: complejidad y
  //      no determinismo evitables».
  //
  // Consecuencia asumida y visible: el peso de A puede seguir contando a través de B aunque el peso
  // propio de B se haya devuelto. Es coherente —lo devuelto es el voto de B, no el mandato de B—, y
  // los dos reciben su aviso de C.4.3 con el motivo correcto.
  const returnedByCap: MemberId[] = [];
  for (const terminal of sortIds([...carried.keys()])) {
    const bucket = carried.get(terminal);
    // Inalcanzable: `terminal` viene literalmente de `carried.keys()`, así que `carried.get(terminal)`
    // no puede dar `undefined`. TypeScript no lo sabe —`Map.get` siempre tipa `V | undefined`—, pero
    // el propio bucle lo hace imposible en tiempo de ejecución. Mutante demostrado equivalente
    // (§10), no deuda de prueba.
    if (bucket === undefined) continue;
    // Se devuelve primero la delegación MÁS RECIENTE: es la marginal que empujó por encima del
    // tope y la que recibió la advertencia al concederse. FIFO castigaría a quien delegó hace
    // meses y confió, e incentivaría delegar tarde.
    const lifo = [...bucket].sort((a, b) =>
      a.viaSeq !== b.viaSeq ? b.viaSeq - a.viaSeq : compareIds(b.delegator, a.delegator),
    );
    let weight = weightOf.get(terminal) ?? 1;
    for (const assignment of lifo) {
      if (weight <= cap) break;
      weight -= 1;
      returnedByCap.push(assignment.delegator);
      unassigned.push({ member: assignment.delegator, reason: 'cap-returned' });
    }
    weightOf.set(terminal, weight);
  }
  const returned = new Set<MemberId>(returnedByCap);

  // ── PASO 6: `onBehalfOf` en orden canónico ──────────────────────────────────────────────────
  const onBehalfOf = new Map<MemberId, readonly MemberId[]>();
  for (const voter of direct.keys()) onBehalfOf.set(voter, []);
  for (const [terminal, bucket] of carried) {
    onBehalfOf.set(
      terminal,
      sortIds(bucket.filter((a) => !returned.has(a.delegator)).map((a) => a.delegator)),
    );
  }

  return {
    at: closedAt,
    capWeight: cap,
    edges,
    assignments: assignments.filter((a) => !returned.has(a.delegator)),
    unassigned: [...unassigned].sort((a, b) => compareIds(a.member, b.member)),
    weightOf,
    onBehalfOf,
    returnedByCap,
    cycleMembers: sortIds(cycleMembers),
  };
}

/**
 * El `WeightResolver` de la PARTE C: cierra sobre el registro de delegaciones y produce las
 * `EffectiveBallot[]` que consume todo el escrutinio.
 *
 * Las delegaciones se pasan por cierre y no por el propio `WeightResolver` porque su firma
 * —`(config, ballots, closedAt)`— es el punto de extensión que B.0.1 congeló, y porque una
 * delegación por tema **no vive en el log de una decisión**: vale para todas las decisiones de ese
 * tema, incluidas las que aún no existen. Ver la errata E-36.
 *
 * Con `delegation.enabled === false` devuelve exactamente `directWeightResolver`: una persona, un
 * voto. No es una comodidad; es la garantía de que activar la delegación es un acto explícito de
 * configuración y de que un registro de delegaciones colgado por error no altera un escrutinio que
 * se abrió sin delegación.
 */
export function delegationWeightResolver(delegations: readonly Delegation[]): WeightResolver {
  return (config, ballots, closedAt) => {
    if (!config.delegation.enabled) return directWeightResolver(config, ballots, closedAt);
    const resolution = resolveDelegation(config, ballots, delegations, closedAt);
    const effective: EffectiveBallot[] = [];
    for (const ballot of ballots) {
      const weight = resolution.weightOf.get(ballot.voter);
      if (weight === undefined) continue; // el PASO 1 la descartó.
      effective.push({
        voter: ballot.voter,
        payload: ballot.payload,
        weight,
        seq: ballot.seq,
        // `?? []` es inalcanzable: `weight` (arriba) ya exigió que `ballot.voter` esté en
        // `weightOf`, y PASO 4/PASO 6 pueblan `weightOf` y `onBehalfOf` con EXACTAMENTE las mismas
        // claves (`direct.keys()` y `assignment.terminal` en los dos, a la vez). Toda clave de
        // `weightOf` es también clave de `onBehalfOf`. Mutante demostrado equivalente (§10), no
        // deuda de prueba.
        onBehalfOf: resolution.onBehalfOf.get(ballot.voter) ?? [],
      });
    }
    return effective.sort((a, b) => compareIds(a.voter, b.voter));
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Aviso de cadena rota (C.4.3) — DATO de salida, nunca un efecto
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ChainBrokenNotice {
  readonly member: MemberId;
  readonly reason: UnassignedReason;
  /** `closesAt − brokenChainNotice`, nunca antes de `opensAt`. */
  readonly noticeAt: Instant;
  readonly closesAt: Instant;
}

/**
 * C.4.3 — «Tu voto no se está contando en *(título)*. Podés votar directamente hasta *(fecha)*.»
 *
 * Es un **requisito funcional**, no una cortesía: sin él, C.4.c (truncar por profundidad) y C.5
 * (devolver por tope) convierten un tecnicismo en desafiliación silenciosa.
 *
 * El dominio es puro: esto devuelve la **lista de avisos que corresponde emitir**, con el instante en
 * que corresponde emitirlos. Quien los envía es la capa de aplicación; quien decide a quién y cuándo
 * es el dominio, que es donde la regla es auditable.
 *
 * La lista incluye `no-delegation`, es decir, a todo el censo silencioso, tal como C.4.3 enumera. El
 * `reason` viaja con cada aviso para que el mensaje pueda ser el correcto: «tu cadena se rompió» y
 * «todavía no votaste» no son la misma frase.
 */
export function chainBrokenNotices(
  config: DecisionConfig,
  resolution: DelegationResolution,
  closesAt: Instant,
): readonly ChainBrokenNotice[] {
  const raw = closesAt - config.delegation.brokenChainNotice;
  const noticeAt = instant(Math.max(raw, config.window.opensAt));
  return resolution.unassigned.map((entry) => ({
    member: entry.member,
    reason: entry.reason,
    noticeAt,
    closesAt,
  }));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Comprobaciones EX ANTE, al conceder y al revocar
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Todo lo que debe cumplirse para que `DelegationGranted` entre en el log.
 *
 * Es la comprobación que de verdad cuenta. C.5.b.1 lo dice sin rodeos: el tope «se verifica al
 * conceder […]; el recorte en el escrutinio es sólo una red de seguridad». Y C.4.a: los ciclos «se
 * PREVIENEN al conceder». Un rechazo aquí es un mensaje que la persona lee y puede accionar; el
 * mismo hecho descubierto en el escrutinio es silencio irreversible.
 *
 * `delegations` es el registro **sin** el candidato.
 */
export function assertDelegationGrantable(
  config: DecisionConfig,
  delegations: readonly Delegation[],
  candidate: Delegation,
): void {
  if (!config.delegation.enabled) {
    throw new PreconditionError(
      'DELEGATION_DISABLED',
      'esta decisión se abrió sin delegación: aceptar la concesión y no resolverla haría que un ' +
        'voto delegado simplemente no existiera (INV-32)',
    );
  }
  if (candidate.delegator === candidate.delegate) {
    throw new PreconditionError(
      'SELF_DELEGATION',
      'delegar en uno mismo no es delegar: si querés votar, votá',
    );
  }
  const census = new Set<MemberId>(config.electorate.members.map((m) => m.memberId));
  if (!census.has(candidate.delegator)) {
    throw new PreconditionError(
      'DELEGATOR_NOT_IN_CENSUS',
      'quien no está en el padrón congelado no tiene voto que delegar (A.1)',
    );
  }
  if (!census.has(candidate.delegate)) {
    throw new PreconditionError(
      'DELEGATE_NOT_IN_CENSUS',
      'no se delega en quien no está en el padrón congelado: la arista nacería muerta (C.3 PASO 2)',
    );
  }
  if (delegations.some((d) => d.delegationId === candidate.delegationId)) {
    throw new PreconditionError(
      'DUPLICATE_DELEGATION',
      `la delegación ${candidate.delegationId} ya existe en este log`,
    );
  }
  if (candidate.revokedAt !== undefined) {
    throw new PreconditionError(
      'DELEGATION_BORN_REVOKED',
      'una concesión no puede traer ya su propia revocación: revocar es un acto posterior y propio',
    );
  }
  if (candidate.expiresAt <= candidate.grantedAt) {
    throw new PreconditionError(
      'DELEGATION_EXPIRY_INVALID',
      'la vigencia debe ser un intervalo no vacío: `grantedAt < expiresAt` (C.1.a)',
    );
  }
  if (candidate.expiresAt - candidate.grantedAt > config.delegation.maxValidity) {
    throw new PreconditionError(
      'DELEGATION_VALIDITY_EXCEEDED',
      'no existe la delegación perpetua: la vigencia máxima es un semestre y la renovación es ' +
        'explícita, jamás automática (C.1.a)',
    );
  }
  if (wouldCreateCycle(delegations, candidate)) {
    throw new PreconditionError(
      'DELEGATION_WOULD_CREATE_CYCLE',
      'esa persona ya te delega a vos (directamente o a través de una cadena): si delegás en ella, ' +
        'ninguno de los dos votaría (C.4.a)',
    );
  }
  // Tope EX ANTE, con el candidato ya dentro: nadie se entera en el cierre (C.5.b.1). Se proyecta
  // en `firstActiveInstant`, el primer instante en que la arista existe: en `grantedAt` todavía no.
  const projected = projectedRepresented(
    [...delegations, candidate],
    candidate.delegate,
    firstActiveInstant(candidate),
    config.delegation.maxDepth,
  );
  const cap = capWeight(config);
  if (projected.length + 1 > cap) {
    throw new PreconditionError(
      'DELEGATION_CAP_REACHED',
      `esa persona ya representaría a ${String(projected.length)} miembros y el tope de ` +
        `concentración es ${String(cap)} votos sobre un censo de ` +
        `${String(config.electorate.censusSize)} (C.5)`,
    );
  }
}

/** La delegación que una concesión nueva desplaza (C.1.b), o `undefined` si no hay ninguna. */
export function supersededByGrant(
  delegations: readonly Delegation[],
  candidate: Delegation,
): Delegation | undefined {
  return findSupersededDelegation(delegations, candidate);
}

/** Precondiciones de `DelegationRevoked`. La revocación tiene efecto INMEDIATO (C.2, INV-24). */
export function assertDelegationRevocable(
  delegations: readonly Delegation[],
  delegationId: DelegationId,
  at: Instant,
): Delegation {
  const delegation = delegations.find((d) => d.delegationId === delegationId);
  if (delegation === undefined) {
    throw new PreconditionError(
      'UNKNOWN_DELEGATION',
      `la delegación ${delegationId} no existe en este log`,
    );
  }
  if (delegation.revokedAt !== undefined) {
    throw new PreconditionError(
      'DELEGATION_ALREADY_REVOKED',
      `la delegación ${delegationId} ya fue revocada en ${String(delegation.revokedAt)}`,
    );
  }
  if (at <= delegation.grantedAt) {
    throw new PreconditionError(
      'DELEGATION_REVOKED_BEFORE_GRANT',
      'no se revoca un mandato antes de haberlo dado',
    );
  }
  return delegation;
}

/** Aplica la revocación al registro, sin mutar el arreglo recibido. */
export function revokeIn(
  delegations: readonly Delegation[],
  delegationId: DelegationId,
  at: Instant,
): readonly Delegation[] {
  return delegations.map((d) => (d.delegationId === delegationId ? { ...d, revokedAt: at } : d));
}

/** ¿Hay alguna delegación vigente en `at` cuyo ámbito case con esta decisión? (ADR-0030). */
export function hasActiveDelegationsFor(
  config: DecisionConfig,
  delegations: readonly Delegation[],
  at: Instant,
): boolean {
  const subject: ScopeSubject = { circleId: config.circleId, topics: config.topics };
  return delegations.some((d) => isDelegationActive(d, at, subject));
}

/**
 * ADR-0030, en su forma FUERTE: «el sistema rechaza abrir la decisión **si hay delegaciones
 * vigentes en su ámbito**, y avisa a los delegantes de que deben votar en persona».
 *
 * Es una regla más estricta que la de C.7.a, que sólo mira `delegation.enabled`, y por precedencia
 * (`GOVERNANCE.md → THREAT_MODEL.md → adr/ → research/`) manda el ADR. La diferencia no es
 * cosmética: una decisión secreta abierta con `enabled: false` mientras Ana tiene una delegación
 * vigente sobre ese tema es exactamente la delegación «inerte» que el ADR llama «la peor opción»
 * —Ana cree que participó y no participó, y sólo lo descubre, si acaso, al ver el conteo—.
 * Reportado como errata E-43.
 *
 * `delegations` es el registro de la comunidad: no vive en el log de esta decisión (E-36), así que
 * lo aporta el llamante. Con la lista vacía la comprobación se reduce a la de C.7.a, que es el
 * comportamiento correcto para quien todavía no tiene registro.
 */
export function assertNoDelegationInSecretBallot(
  config: DecisionConfig,
  delegations: readonly Delegation[],
  at: Instant,
): void {
  if (config.privacy !== 'secret-ballot') return;
  if (config.delegation.enabled) {
    throw new PreconditionError(
      'SECRET_BALLOT_WITH_DELEGATION',
      'un voto secreto con delegación es un voto secreto con una puerta trasera pública y ' +
        'verificable: al coaccionador le basta con exigirte que delegues en él (C.7.a / ADR-0030)',
    );
  }
  const activas = delegations.filter((d) =>
    isDelegationActive(d, at, { circleId: config.circleId, topics: config.topics }),
  );
  if (activas.length > 0) {
    throw new PreconditionError(
      'SECRET_BALLOT_WITH_ACTIVE_DELEGATIONS',
      `hay ${String(activas.length)} delegación(es) vigentes en el ámbito de esta decisión y el ` +
        'voto es secreto: no se abre con la delegación inerte —quien delegó creería haber ' +
        'participado sin haberlo hecho—; hay que avisar a esas personas de que voten en persona ' +
        '(ADR-0030)',
    );
  }
}

/** Delegaciones vigentes en `at`, sin filtrar por ámbito. Para el registro público de C.7.b. */
export function vigentDelegations(
  delegations: readonly Delegation[],
  at: Instant,
): readonly Delegation[] {
  return delegations.filter((d) => isVigent(d, at));
}

/** Clave `(delegante, ámbito)`: la casilla única de C.1.b. Expuesta para la interfaz y los tests. */
export function delegationSlot(delegation: Delegation): string {
  return `${delegation.delegator}|${scopeKey(delegation.scope)}`;
}
