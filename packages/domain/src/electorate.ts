/**
 * `Electorate` — el padrón congelado (A.2).
 *
 * Tres reglas normativas, y las tres son contraintuitivas la primera vez que se leen:
 *
 *  - **A.1** El padrón se congela en `Draft → Open` y es inmutable. Quien se matricula después de
 *    `frozenAt` **no vota**, aunque la ventana siga abierta. Sin `N` fijo, «dos tercios del censo»
 *    deja de ser una proposición con valor de verdad hasta que cierra la votación, y un mismo
 *    conjunto de votos puede pasar y luego fallar. Además cierra el relleno de urna administrativo:
 *    matricular aliados cuando ya se conoce el marcador parcial.
 *  - **A.2** Quien votó y **luego** se retiró: su voto cuenta y sigue en el denominador. La
 *    legitimidad de un acto se juzga por las condiciones del momento del acto (*tempus regit
 *    actum*), y si el retiro borrara votos el resultado dependería de hechos posteriores al cierre
 *    del padrón. Cierra además el **ataque de deserción**: una minoría que va perdiendo se retira en
 *    masa para tumbar el quórum.
 *  - **A.3** Quien se retira **sin** haber votado tampoco sale de `N`: sacarlo permitiría fabricar
 *    quórum reduciendo el denominador.
 *
 * Las tres se implementan por construcción: el padrón congelado es la **única** fuente de
 * elegibilidad del escrutinio. No hay ninguna consulta al registro vivo, porque esa consulta es
 * exactamente el bug que INV-03 e INV-04 describen.
 *
 * ═══ `rollHash` ═══
 *
 * Resolución del arquitecto: el hash del padrón se calcula **sólo sobre los `MemberId` ordenados**,
 * nunca sobre atributos como el semestre o el círculo. Así el padrón se puede publicar y verificar
 * sin exponer un solo atributo de nadie, y una corrección administrativa de un atributo (que no
 * cambia quién puede votar) no invalida un hash ya publicado.
 *
 * DECISIÓN: esto **diverge de la redacción de A.2**, que define
 * `rollHash = hash({ frozenAt, registryVersion, members })`. Manda la resolución del arquitecto.
 * `frozenAt` y `registryVersion` siguen dentro de `configHash`, así que no se pierde anclaje: lo
 * que cambia es que el hash del padrón identifica **el conjunto de electores** y nada más.
 */

import { hashCanonical } from './canonical.js';
import { InvalidElectorateError } from './errors.js';
import {
  type CircleId,
  compareIds,
  type Hash,
  type Instant,
  isStrictlySorted,
  type MemberId,
  sortIds,
  type StratumKey,
  type StratumValue,
} from './ids.js';

/** Miembro elegible, tal como quedó fotografiado en el instante de congelación. */
export interface EligibleMember {
  readonly memberId: MemberId;
  /** Peso base. SIEMPRE 1: el poder desigual sólo puede venir de una delegación explícita. */
  readonly baseWeight: 1;
  /** Círculos a los que pertenece en `frozenAt`. Estrictamente ordenado. */
  readonly circles: readonly CircleId[];
  /** Atributos para sorteo estratificado y quórum por círculo. Claves estrictamente ordenadas. */
  readonly strata: Readonly<Record<StratumKey, StratumValue>>;
}

export interface Electorate {
  /** Identidad del padrón. Coincide con `rollHash`. */
  readonly snapshotId: Hash;
  /** Instante EXACTO de congelación. Coincide con `DecisionOpened.occurredAt`. */
  readonly frozenAt: Instant;
  /** Estrictamente ordenada por `memberId` (byte a byte). Sin duplicados. */
  readonly members: readonly EligibleMember[];
  /** `=== members.length`. Es la `N` de toda la especificación. */
  readonly censusSize: number;
  /** `hash({ memberIds: [...ordenados] })`. Ver la cabecera de este módulo. */
  readonly rollHash: Hash;
  /** Versión monotónica del registro institucional del que se derivó. */
  readonly registryVersion: number;
  /** Criterio legible: «matriculados activos del Instituto de Filosofía al 2026-08-21». */
  readonly criterion: string;
}

/**
 * Una fila del registro institucional de matrícula. **No** es parte del padrón: es la entrada de la
 * congelación. El dominio no guarda esto: lo consume y produce el `Electorate`.
 */
export interface RegistryEntry {
  readonly memberId: MemberId;
  /** Instante de alta. */
  readonly enrolledAt: Instant;
  /** Instante de baja, si la hubo. */
  readonly withdrawnAt?: Instant;
  readonly circles?: readonly CircleId[];
  readonly strata?: Readonly<Record<StratumKey, StratumValue>>;
}

/**
 * `rollHash = sha256Hex(jcs({ memberIds: [...] }))`, con los identificadores **ordenados byte a
 * byte**. Ordena por su cuenta: un llamante que pase la lista desordenada obtiene el mismo hash,
 * que es justo lo que se quiere (el padrón es un conjunto, no una secuencia).
 */
export async function computeRollHash(memberIds: readonly MemberId[]): Promise<Hash> {
  return hashCanonical({ memberIds: sortIds(memberIds) });
}

/**
 * ¿Esta fila del registro entra en el padrón que se congela en `at`?
 *
 * DECISIÓN: la frontera es **semiabierta por los dos lados**, `enrolledAt < at <= withdrawnAt`:
 *  - quien se matricula exactamente en `at` NO entra;
 *  - quien se da de baja exactamente en `at` SÍ entra.
 *
 * La prosa de A.1 dice «quien se matricula *después* de `frozenAt` no vota» (lo que dejaría dentro
 * el alta simultánea), pero INV-03 lo formaliza como `enrolledAt ≥ frozenAt ⇒ m ∉ members`, que la
 * deja fuera. **Se sigue el invariante**, porque es el contrato ejecutable y porque coincide con la
 * convención de intervalos semiabiertos que D.3.b impone al cierre de la ventana y C.2 a la vigencia
 * de las delegaciones: `[apertura, cierre)`. Una plataforma con dos convenciones de frontera
 * distintas tiene un litigio garantizado en el milisegundo exacto. Reportado como error de la spec.
 */
export function isEnrolledAt(entry: RegistryEntry, at: Instant): boolean {
  if (entry.enrolledAt >= at) return false;
  return entry.withdrawnAt === undefined || entry.withdrawnAt >= at;
}

function normalizeStrata(
  strata: Readonly<Record<StratumKey, StratumValue>> | undefined,
): Readonly<Record<StratumKey, StratumValue>> {
  if (strata === undefined) return {};
  const keys = Object.keys(strata).sort(compareIds);
  const out: Record<StratumKey, StratumValue> = {};
  for (const key of keys) {
    const value = strata[key as StratumKey];
    if (value === undefined) continue;
    out[key as StratumKey] = value;
  }
  return out;
}

/**
 * Congela el padrón en el instante `at` (que será el `occurredAt` de `DecisionOpened`).
 *
 * Ordena, deduplica, normaliza los estratos y calcula el `rollHash`. A partir de aquí, el padrón es
 * el único hecho relevante sobre quién puede votar: el registro vivo deja de importar para esta
 * decisión, para siempre.
 */
export async function freezeElectorate(input: {
  readonly registry: readonly RegistryEntry[];
  readonly at: Instant;
  readonly registryVersion: number;
  readonly criterion: string;
}): Promise<Electorate> {
  const { registry, at, registryVersion, criterion } = input;

  if (!Number.isSafeInteger(registryVersion) || registryVersion < 0) {
    throw new InvalidElectorateError('registryVersion debe ser un entero no negativo');
  }
  if (criterion.trim() === '') {
    throw new InvalidElectorateError('el criterio debe ser una frase legible, no una cadena vacía');
  }
  if (criterion.normalize('NFC') !== criterion) {
    throw new InvalidElectorateError('el criterio debe venir normalizado en NFC (A.1.1)');
  }

  const seen = new Set<string>();
  for (const entry of registry) {
    if (seen.has(entry.memberId)) {
      throw new InvalidElectorateError(`el registro trae dos veces a ${entry.memberId}`);
    }
    seen.add(entry.memberId);
  }

  const members: EligibleMember[] = registry
    .filter((entry) => isEnrolledAt(entry, at))
    .map((entry) => ({
      memberId: entry.memberId,
      baseWeight: 1 as const,
      circles: sortIds(entry.circles ?? []),
      strata: normalizeStrata(entry.strata),
    }))
    .sort((a, b) => compareIds(a.memberId, b.memberId));

  const rollHash = await computeRollHash(members.map((m) => m.memberId));

  const electorate: Electorate = {
    snapshotId: rollHash,
    frozenAt: at,
    members,
    censusSize: members.length,
    rollHash,
    registryVersion,
    criterion,
  };
  assertWellFormedElectorate(electorate);
  return electorate;
}

/** INV-06 — el padrón está bien formado. Se comprueba al congelar y al abrir. */
export function assertWellFormedElectorate(electorate: Electorate): void {
  if (electorate.censusSize !== electorate.members.length) {
    throw new InvalidElectorateError(
      `censusSize (${String(electorate.censusSize)}) no coincide con members.length ` +
        `(${String(electorate.members.length)})`,
    );
  }
  if (!isStrictlySorted(electorate.members.map((m) => m.memberId))) {
    throw new InvalidElectorateError(
      'los miembros deben venir estrictamente ordenados por memberId, byte a byte, sin duplicados',
    );
  }
  for (const member of electorate.members) {
    // El tipo ya fija `1`, pero el padrón puede llegar deserializado desde fuera de TypeScript: la
    // comprobación se hace sobre el valor, no sobre la promesa del compilador.
    const weight: number = member.baseWeight;
    if (weight !== 1) {
      throw new InvalidElectorateError(
        `${member.memberId} tiene baseWeight ${String(weight)}: el peso base es siempre 1`,
      );
    }
    if (!isStrictlySorted(member.circles)) {
      throw new InvalidElectorateError(
        `los círculos de ${member.memberId} deben estar estrictamente ordenados`,
      );
    }
  }
  if (electorate.snapshotId !== electorate.rollHash) {
    throw new InvalidElectorateError('snapshotId debe coincidir con rollHash (A.2)');
  }
}

/** Verifica que el `rollHash` almacenado corresponde a los miembros que trae el padrón (INV-05). */
export async function verifyRollHash(electorate: Electorate): Promise<boolean> {
  const recomputed = await computeRollHash(electorate.members.map((m) => m.memberId));
  return recomputed === electorate.rollHash;
}

/**
 * ¿`candidate` está en el padrón congelado? Búsqueda binaria sobre el arreglo ordenado: `O(log N)`
 * y, sobre todo, **sin `Set`**, cuyo orden de iteración no es una fuente de verdad admisible.
 */
export function isEligible(electorate: Electorate, candidate: MemberId): boolean {
  return indexOfMember(electorate, candidate) >= 0;
}

/** Índice del miembro en el padrón, o `-1`. */
export function indexOfMember(electorate: Electorate, candidate: MemberId): number {
  let low = 0;
  let high = electorate.members.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const member = electorate.members[mid];
    if (member === undefined) return -1;
    const c = compareIds(member.memberId, candidate);
    if (c === 0) return mid;
    if (c === -1) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

export function memberAt(electorate: Electorate, candidate: MemberId): EligibleMember | undefined {
  const index = indexOfMember(electorate, candidate);
  return index < 0 ? undefined : electorate.members[index];
}

/** Miembros del padrón que pertenecen al círculo `circle`, en orden de padrón. */
export function membersOfCircle(electorate: Electorate, circle: CircleId): readonly MemberId[] {
  return electorate.members.filter((m) => m.circles.includes(circle)).map((m) => m.memberId);
}

/** `|M_c|` de D.1.3. Cero significa «este quórum por círculo NO se cumple», nunca «se cumple». */
export function circleSize(electorate: Electorate, circle: CircleId): number {
  return membersOfCircle(electorate, circle).length;
}
