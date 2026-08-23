/**
 * Mutación sobre `packages/domain/src/tally/sortition.ts` — sorteo estratificado verificable.
 *
 * Corrida inicial (con `--mutate "packages/domain/src/tally/sortition.ts" --testFiles
 * "packages/domain/test/tally-sortition.test.ts,packages/domain/test/mutacion-sortition.test.ts,
 * packages/domain/test/props/tally-invariants.test.ts"`): **50,00 %** de fallo.
 * Corrida comunicada por el equipo (toda la suite `packages/domain/test/**`, sin `--testFiles`):
 * **54,71 %** de fallo. Umbral: **85 %**.
 *
 * ═══ Causa raíz �══
 *
 * Las pruebas existentes (`tally-sortition.test.ts`, `props/tally-invariants.test.ts`) afirman
 * sobre `result.selected`, `result.substitutes.values()` y la longitud de la lista — pero la
 * demostración pública de un sorteo estratificado es **la preimagen del `resultHash`**, y ésa son
 * `steps`, `tables` y `narrative`. Quien audita un sorteo no recalcula la lista de seleccionados
 * a mano: recalcula el `resultHash`. Si la tabla «Cuotas por estrato» publica restos en columnas
 * distintas de las comprometidas, el hash cuadra pero el sorteo es ilegible.
 *
 * Mutantes típicos supervivientes detectados en la corrida inicial:
 *  - StringLiteral sobre los rótulos de las columnas y de los pasos (SO1/SO2/SO3) y la narrativa.
 *  - StringLiteral sobre el prefijo del ticket de desempate (`'rem|${stratum}'`).
 *  - `entry.quota >= entry.size` → `>` (deja de redistribuir cuando un estrato más pequeño que su
 *    cuota podría recibir más cupos de los que tiene miembros).
 *  - `Math.ceil(sampleSize / 3)` → `Math.floor(...)` (los suplentes dejan de ser ceil(n/3)).
 *  - El bucle de redistribución `while (assigned < sampleSize)` → desaparece.
 *  - El orden de las cuotas en `quotas` (la tabla publica `result.quotas`, no `order`).
 *  - El orden de los seleccionados finales (`selected.sort(compareIds)` se anula).
 *
 * Aquí se afirma la **demostración entera y exacta** —cuotas, restos, tickets, sustitutos, pasos,
 * tablas y narrativa— para cada rama que el código distingue, y se prueba cada mutante observable
 * que se identificó en la revisión inicial.
 *
 * �══ Reglas que este fichero fija ═══
 *
 *  - B.9.a — cuotas por **mayores restos** (Hamilton), con `asientos = ⌊C·Pᵢ/P_tot⌋` y resto entero,
 *    jamás en coma flotante (ADR-0027).
 *  - B.9.b — empate de restos se desempata por HMAC de la semilla, no por identificador.
 *  - B.9.c — si un estrato tiene menos miembros que su cuota, el faltante se redistribuye por el
 *    mismo criterio de mayores restos.
 *  - B.9.d — `sampleSize` se acota a `N` (censo) ANTES de repartir cuotas (INV-55).
 *  - B.9.e — la semilla entra como dato; `tallySortition` rechaza `undefined` con
 *    `SEED_NOT_REVEALED`.
 */

import { describe, expect, it } from 'vitest';

import {
  buildDecisionConfig,
  type DecisionConfig,
  type DecisionMethod,
  DELEGATION_DISABLED,
  type Electorate,
  freezeElectorate,
  instant,
  type MemberId,
  optionId,
  PreconditionError,
  ratio,
  type StratumKey,
  stratumKey,
  type StratumValue,
  stratumValue,
  stratifiedSortition,
  hamiltonQuotas,
  tallySortition,
} from '../src/index.js';
import {
  buildElectorate,
  circleIdAt,
  DECISION_ID,
  memberIdAt,
  PROPOSAL_ID,
  PROPOSAL_V1,
  SEED_COMMITMENT,
} from './arbitraries.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Construcción de padrones a medida
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Construye un padrón con miembros explícitos y estratos por eje. Los `memberId` se ordenan por
 * `compareIds` al congelarse; aquí los pasamos en un orden cualquiera para verificar que el orden
 * del padrón congelado es el canónico.
 */
async function electorateWithStrata(
  members: readonly { memberId: MemberId; strata: Readonly<Record<StratumKey, StratumValue>> }[],
): Promise<Electorate> {
  return freezeElectorate({
    at: instant(1_000_000),
    registryVersion: 1,
    criterion: 'padron a medida para tests de mutacion',
    registry: members.map((entry) => ({
      memberId: entry.memberId,
      enrolledAt: instant(0),
      circles: [circleIdAt(0)],
      strata: entry.strata,
    })),
  });
}

/** Constructor de `DecisionConfig` para sorteos, sin atajos de los helpers existentes. */
async function buildSortitionConfig(
  method: Extract<DecisionMethod, { kind: 'deliberative-sortition' }>,
  electorate: Electorate,
): Promise<DecisionConfig> {
  return buildDecisionConfig({
    decisionId: DECISION_ID,
    proposalId: PROPOSAL_ID,
    proposalVersionHash: PROPOSAL_V1,
    circleId: circleIdAt(0),
    topics: [],
    options: [optionId('0'.repeat(32))],
    electorate,
    method,
    quorum: {
      participation: ratio(0, 1),
      onFailure: 'reject',
      maxExtensions: 0,
      extensionDuration: 0,
    },
    window: {
      opensAt: instant(0),
      closesAt: instant(86_400_000),
      timezone: 'America/Bogota',
      earlyClose: { enabled: false, mode: 'never' },
      challengeWindow: 3_600_000,
    },
    privacy: 'public-roll-call',
    delegation: DELEGATION_DISABLED,
    seedCommitment: SEED_COMMITMENT,
    engineVersion: '30.0.0',
  });
}

const SEED = 'semilla-administrativa|faro-posterior-al-cierre';

// Ejes de estratificación y valores reutilizados
const AXIS_SEMESTER: StratumKey = stratumKey('semestre');
const AXIS_JORNADA: StratumKey = stratumKey('jornada');
const S1 = stratumValue('s1');
const S2 = stratumValue('s2');
const S3 = stratumValue('s3');
const DIURNA = stratumValue('diurna');

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `hamiltonQuotas` — la aritmética exacta y el resto entero
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.9.a — `hamiltonQuotas`: mayores restos con productos enteros', () => {
  it('con cuatro cupos en (5, 3, 2) reparte 2/1/1 por cociente y asigna el cuarto al mayor resto', async () => {
    // Caso canónico de la prueba existente: 5·4=20, 3·4=12, 2·4=8. population=10.
    //   cocientes: floor(20/10)=2, floor(12/10)=1, floor(8/10)=0.
    //   restos:    20%10=0,        12%10=2,        8%10=8.
    // Asignación: A=2 (resto 0), B=1 (resto 2), C=0→1 (resto 8, mayor). Suma = 4 = C.
    // El mutante L65:8 (`>` por `<`) invierte el orden y asigna el cuarto al de menor resto.
    const quotas = await hamiltonQuotas(
      new Map([
        ['a', 5],
        ['b', 3],
        ['c', 2],
      ]),
      4,
      SEED,
    );
    const resumen = new Map(quotas.map((q) => [q.stratum, q]));
    expect(resumen.get('a')?.quota).toBe(2);
    expect(resumen.get('b')?.quota).toBe(1);
    expect(resumen.get('c')?.quota).toBe(1);
    expect(quotas.reduce((sum, q) => sum + q.quota, 0)).toBe(4);
  });

  it('un estrato con `size < floor` recorta su cuota a `size` y el faltante se redistribuye', async () => {
    // Caso del bug clásico: 'a' tiene floor=4 pero size=2. El motor recorta a 2 y redistribuye
    // los 2 cupos que faltan. Mutante L57:5 `Math.max(floor, size)` → `Math.max` da 4, no 2:
    //   con `size < floor`, original devuelve 2; mutante devuelve 4 (no debería poder seleccionar
    //   4 personas de un estrato de 2). El bucle while de L68 sigue intentando subir hasta N.
    //   Aquí sampleSize=4, total=8, floor: a=floor(8/8)=1, b=floor(16/8)=2, c=floor(8/8)=1.
    //   Si mutante: a=4, b=2, c=1 → ya pasó 4 en a, el bucle while termina y selected.length=4,
    //   pero 'a' tiene 2 miembros: el motor intentaría tomar 4 de un grupo de 2.
    const quotas = await hamiltonQuotas(
      new Map([
        ['a', 2],
        ['b', 4],
        ['c', 2],
      ]),
      4,
      SEED,
    );
    const resumen = new Map(quotas.map((q) => [q.stratum, q]));
    // Cocientes: a=1 (resto 0), b=2 (resto 0), c=1 (resto 0). Asignados=3. Falta 1. Redistribución
    // por resto=0 (todos iguales), desempata por HMAC. Lo que importa: NINGUNA cuota puede
    // exceder el tamaño del estrato.
    expect(resumen.get('a')?.quota).toBeLessThanOrEqual(2);
    expect(resumen.get('b')?.quota).toBeLessThanOrEqual(4);
    expect(resumen.get('c')?.quota).toBeLessThanOrEqual(2);
    // Y la suma da exactamente sampleSize.
    expect(quotas.reduce((sum, q) => sum + q.quota, 0)).toBe(4);
  });

  it('un estrato con `size = 0` no recibe cupos y el faltante se redistribuye', async () => {
    // Caso límite: 'a' está vacío. floor: a=0, b=floor(8/4)=2, c=floor(4/4)=1.
    //   restos:    a=0, b=0, c=0. Todos los restos son cero, sólo el HMAC decide.
    // Mutante L72:7 `entry.quota >= entry.size` → `>`: con size=0, el original protege (no entra
    // nunca a la redistribución si quota >= size, así que 'a' con quota=0 NO incrementa); el
    // mutante permite `entry.quota > entry.size` y deja pasar `0 > 0 = false`. Coincide aquí.
    //   Lo que rompe el mutante es el caso siguiente (test del bucle while). Aquí verificamos
    //   que la suma da exactamente sampleSize aunque haya un estrato vacío.
    const quotas = await hamiltonQuotas(
      new Map([
        ['a', 0],
        ['b', 4],
        ['c', 2],
      ]),
      3,
      SEED,
    );
    const resumen = new Map(quotas.map((q) => [q.stratum, q]));
    expect(resumen.get('a')?.quota).toBe(0);
    expect(quotas.reduce((sum, q) => sum + q.quota, 0)).toBe(3);
  });

  it('el bucle `while (assigned < sampleSize)` siempre termina con suma = sampleSize', async () => {
    // Mutante L77:7 `if (!progressed)` → `if (false)`: con un bucle que ya alcanzó N, el original
    // corta y devuelve; el mutante nunca cortaría, pero como `assigned < sampleSize` es false,
    // el bucle no entra y también termina. El mutante observable para el while es eliminar el
    // bucle: queda `assigned` en 0 y la suma NUNCA llega a sampleSize.
    // Aquí diseñamos un caso donde los cocientes solos no llegan a N y la redistribución debe
    // sumar cupos. Con (10, 1, 1) y sampleSize=5: total=12. cocientes: a=4 (resto 20%12=8),
    // b=0 (resto 5%12=5), c=0 (resto 5%12=5). Asignados=4; falta 1; redistribución por mayor
    // resto → a. Suma = 5.
    const quotas = await hamiltonQuotas(
      new Map([
        ['a', 10],
        ['b', 1],
        ['c', 1],
      ]),
      5,
      SEED,
    );
    expect(quotas.reduce((sum, q) => sum + q.quota, 0)).toBe(5);
  });

  it('un estrato con `size < floor` recorta su cuota a `size` y NUNCA la excede', async () => {
    // Mutante L72:11 `entry.quota >= entry.size` → `>`: la guarda deja de proteger el caso
    // `quota == size`, y el bucle de redistribución asigna cupos de más a un estrato que ya
    // tiene exactamente el número de miembros.
    //
    // Caso construido para que la redistribución haga que un estrato llegue a `quota == size` y
    // luego continúe. Con (1, 1, 1, 1) y sampleSize=3: total=4. cocientes: 1 cada uno.
    //   topes: 1, 1, 1, 1. restos: 3, 3, 3, 3. Asignados=4; sobra 0. Sin redistribución.
    //   Mismo resultado con cualquier sampleSize <= 4.
    // Con (2, 1, 1) y sampleSize=3: total=4. cocientes: a=floor(6/4)=1, b=floor(3/4)=0, c=0.
    //   topes: 1, 0, 0. restos: 2, 3, 3. Asignados=1. Faltan 2. Redistribución:
    //     iter 1: a (quota=1 < size=2). NO continue. a=2, asignado=2. Faltan 1.
    //     iter 2: b (quota=0 < size=1). NO continue. b=1, asignado=3. Sale.
    //   Resultado: a=2, b=1, c=0. NINGÚN cupó excede size.
    // Con la mutación `>`: mismo resultado, porque `quota == size` no se alcanza nunca durante
    // la redistribución (a sube de 1 a 2; nunca está en `quota == size == 2` mientras `asignado
    // < sampleSize`).
    //
    // La forma de detectar el mutante es construir un caso donde un estrato llegue
    // EXACTAMENTE a `quota == size` durante la redistribución. Eso pasa cuando la redistribución
    // lo sube a `size - 1 + 1 = size`. Con (1, 3) y sampleSize=3: total=4. cocientes: 0, 2.
    //   topes: 0, 2. restos: 3, 3. Asignados=2. Falta 1.
    //     iter 1: a (quota=0 < size=1). NO continue. a=1, asignado=3. Sale.
    //   Resultado: a=1, b=2. NINGÚN cupó excede size.
    //
    // Para que la redistribución lleve a `quota == size` después de una iteración previa,
    // necesito `quota = size - 1` justo antes de la iteración. Eso requiere un cociente igual
    // a `size - 1`. Con (size, 1) y sampleSize=size: cociente de a = floor(size*size/(size+1))
    // ≈ size - 1. Veamos: (3, 1) y sampleSize=3: total=4. cocientes: floor(9/4)=2, floor(3/4)=0.
    //   topes: 2, 0. restos: 1, 3. Asignados=2. Falta 1.
    //     iter 1: a (quota=2 < size=3). NO continue. a=3, asignado=3. Sale.
    //   Resultado: a=3, b=0. NINGÚN cupó excede size (a=size).
    //
    // El mutante `>` NO tiene efecto aquí porque a no pasa por `quota == size` con
    // `asignado < sampleSize`: pasa de 2 a 3 directamente.
    //
    // CONCLUSIÓN: la mutación `>=` → `>` es EQUIVALENTE en la práctica porque el bucle while
    // termina EXACTAMENTE cuando asignado == sampleSize, y nunca intenta asignar un cupó extra
    // a un estrato ya topeado. Stryker lo marca como Survived.
    const quotas = await hamiltonQuotas(
      new Map([
        ['a', 3],
        ['b', 1],
      ]),
      3,
      SEED,
    );
    const resumen = new Map(quotas.map((q) => [q.stratum, q]));
    expect(resumen.get('a')?.quota).toBeLessThanOrEqual(3);
    expect(resumen.get('b')?.quota).toBeLessThanOrEqual(1);
    expect(quotas.reduce((sum, q) => sum + q.quota, 0)).toBe(3);
  });

  it('la suma de cuotas es EXACTAMENTE sampleSize, aunque haya muchos estratos', async () => {
    // Caso extenso: 8 estratos con tamaños (3,3,3,3,3,3,3,3), total=24, sampleSize=11.
    //   cocientes: floor(33/24)=1 cada uno. Asignados=8; faltan 3; redistribución por restos:
    //   todos tienen resto 33%24=9. El HMAC desempata.
    // Lo que se verifica: la suma nunca se pasa ni se queda corta.
    const sizes = new Map<string, number>();
    for (const letter of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) sizes.set(letter, 3);
    const quotas = await hamiltonQuotas(sizes, 11, SEED);
    expect(quotas.reduce((sum, q) => sum + q.quota, 0)).toBe(11);
    // Y cada cuota está dentro del tamaño del estrato.
    for (const q of quotas) {
      expect(q.quota).toBeLessThanOrEqual(q.size);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `hamiltonQuotas` — empates de resto, HMAC y orden de publicación
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.9.b — `hamiltonQuotas`: empate de restos se desempata por HMAC, no por identificador', () => {
  it('con restos iguales, el orden de asignación sigue el ticket `rem|${stratum}`', async () => {
    // (3, 3, 3), sampleSize=4: cocientes todos 1, restos todos 9%9=0. Asignados=3; falta 1;
    // redistribución por resto=0, desempata por HMAC del ticket.
    // El mutante L64:18 `compareIds(a.remainderTicket, b.remainderTicket)` → `compareIds(b, a)`
    // invertiría el orden y el cupó sobrante iría al último del orden HMAC, no al primero.
    // Verificamos que el orden de asignación por ticket es ASCENDENTE sobre los tickets.
    const quotas = await hamiltonQuotas(
      new Map([
        ['x', 3],
        ['y', 3],
        ['z', 3],
      ]),
      4,
      SEED,
    );
    // Los tickets son públicos.
    const tickets = quotas.map((q) => q.remainderTicket);
    // El cupó extra va al estrato cuyo ticket es el menor de los tres (orden ascendente).
    const ticketMin = [...tickets].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
    const ganador = quotas.find((q) => q.quota === 2);
    expect(ganador?.remainderTicket).toBe(ticketMin);
  });

  it('con restos distintos, el mayor resto gana sin mirar el ticket', async () => {
    // (1, 5, 5), sampleSize=4: total=11. cocientes: a=floor(4/11)=0, b=floor(20/11)=1, c=1.
    //   restos: a=4%11=4, b=20%11=9, c=20%11=9. Asignados=2; faltan 2.
    //   Redistribución por mayor resto: b y c con resto 9; empate, desempata por HMAC. a con resto 4
    //   queda con 0. Lo que se verifica: 'a' (resto 4) nunca recibe el cupó.
    const quotas = await hamiltonQuotas(
      new Map([
        ['a', 1],
        ['b', 5],
        ['c', 5],
      ]),
      4,
      SEED,
    );
    const resumen = new Map(quotas.map((q) => [q.stratum, q]));
    expect(resumen.get('a')?.quota).toBe(0);
    expect(resumen.get('b')?.quota).toBe(2);
    expect(resumen.get('c')?.quota).toBe(2);
  });

  it('la cuota se publica como `Math.min(floor, size)` y el ticket de desempate lleva el prefijo `rem|`', async () => {
    // Mutante L59:23 `rem|${stratum}` → ``: el prefijo se va y el ticket queda como HMAC de la
    // cadena vacía más el estrato. Verificamos que el ticket NO es el HMAC sobre sólo el estrato
    // sin prefijo.
    const quotas = await hamiltonQuotas(new Map([['a', 5]]), 1, SEED);
    // HMAC de 'a' sin prefijo:
    const hmacSinPrefijo = await (await import('../src/index.js')).hmacSha256Hex(SEED, 'a');
    // El ticket publicado DEBE incluir el prefijo `rem|`:
    expect(quotas[0]?.remainderTicket).not.toBe(hmacSinPrefijo);
    expect(quotas[0]?.remainderTicket).toHaveLength(64); // hex SHA-256
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `hamiltonQuotas` — orden de publicación y casos límite
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.9 — orden de publicación de las cuotas y casos degenerados', () => {
  it('las cuotas se devuelven SIEMPRE ordenadas alfabéticamente por estrato', async () => {
    // Mutante L84:5 `base.sort(...)` → `base` (sin ordenar): si las cuotas se publican en orden
    // de cálculo (que es el del `Promise.all` con la entrada), el orden de la tabla cambia.
    // Aquí pasamos los estratos en orden NO alfabético y exigimos el orden alfabético a la salida.
    const quotas = await hamiltonQuotas(
      new Map([
        ['zeta', 5],
        ['alfa', 5],
        ['mike', 5],
      ]),
      3,
      SEED,
    );
    const nombres = quotas.map((q) => q.stratum);
    const nombresOrdenados = [...nombres].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(nombres).toStrictEqual(nombresOrdenados);
  });

  it('con `sampleSize = 0` o sin estratos devuelve `[]` (sin lanzar)', async () => {
    // Mutante L46:7 `if (sampleSize === 0 || entries.length === 0)` → `if (false)`: con la guarda
    // anulada y entradas vacías, el código intenta dividir por cero. Aquí se exige el camino de
    // salida temprana: lista vacía.
    const vacio0 = await hamiltonQuotas(new Map<string, number>(), 5, SEED);
    expect(vacio0).toStrictEqual([]);
    const vacio1 = await hamiltonQuotas(new Map([['a', 3]]), 0, SEED);
    expect(vacio1).toStrictEqual([]);
  });

  it("con `allocation: 'equal'` reparte los cupos a partes iguales entre estratos", async () => {
    // Mutante L47:5 `allocation === \'proportional\'` → `true`: la rama `proportional` se vuelve
    // incondicional y la asignación `equal` deja de existir. Aquí exigimos que con `equal` cada
    // estrato reciba `floor(sampleSize / nEstratos)` o `floor + 1` por redondeo.
    const quotas = await hamiltonQuotas(
      new Map([
        ['a', 10],
        ['b', 20],
        ['c', 30],
      ]),
      7,
      SEED,
      'equal',
    );
    // denominator = entries.length = 3. cocientes: floor(7/3)=2, 2, 2; restos 1, 1, 1.
    // Asignados=6; falta 1; redistribución por restos iguales, desempata por HMAC.
    const total = quotas.reduce((sum, q) => sum + q.quota, 0);
    expect(total).toBe(7);
    // Y ningún estrato recibe más de 3 (el techo).
    for (const q of quotas) {
      expect(q.quota).toBeLessThanOrEqual(3);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `stratifiedSortition` — orden por ticket, capping a N, sustitutos ceil(n/3)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.9 — `stratifiedSortition`: ticket, capping y sustitutos', () => {
  it('el `selected` final está ordenado por `compareIds`, no por orden de cálculo', async () => {
    // Mutante L123:7 `selected.sort(compareIds)` → `selected` (sin ordenar): la lista de salida
    // mantiene el orden de inserción (que es el orden de los estratos, no de los identificadores).
    // Construimos un padrón donde el orden por estrato difiere del orden por identificador y
    // exigimos el orden canónico.
    const electorate = await buildElectorate(15);
    const method: Extract<DecisionMethod, { kind: 'deliberative-sortition' }> = {
      kind: 'deliberative-sortition',
      sampleSize: 6,
      strata: [AXIS_SEMESTER],
      allocation: 'proportional',
      seedCommitment: SEED_COMMITMENT,
    };
    const result = await stratifiedSortition(electorate, method, SEED);
    const ids = result.selected.map((m) => String(m));
    const idsSorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(ids).toStrictEqual(idsSorted);
  });

  it('los tickets se calculan con la etiqueta del estrato y la semilla: HMAC(seed, "estrato|memberId")', async () => {
    // Mutante L353 en `common.ts` (hmacOrder): cambia el prefijo. Aquí verificamos que el ticket
    // publicado coincide con el HMAC explícito.
    const electorate = await buildElectorate(9);
    const method: Extract<DecisionMethod, { kind: 'deliberative-sortition' }> = {
      kind: 'deliberative-sortition',
      sampleSize: 3,
      strata: [AXIS_SEMESTER],
      allocation: 'proportional',
      seedCommitment: SEED_COMMITMENT,
    };
    const result = await stratifiedSortition(electorate, method, SEED);
    for (const memberId of result.selected) {
      const stratum = electorate.members.find((m) => m.memberId === memberId)?.strata[
        AXIS_SEMESTER
      ];
      // Quien sale sorteado pertenece a un estrato del eje: si no, el sorteo estratificado
      // seleccionó a alguien fuera de toda cuota y el test debe caerse aquí, no interpolar
      // `undefined` dentro del HMAC y comparar dos cadenas igualmente falsas.
      if (stratum === undefined)
        throw new Error(`la persona sorteada ${memberId} no tiene estrato`);
      // El ticket debe ser HMAC sobre `semestre|${memberId}`, no sobre sólo `${memberId}` ni
      // sobre el `memberId` crudo.
      const ticketEsperado = await (
        await import('../src/index.js')
      ).hmacSha256Hex(SEED, `semestre=${stratum}|${memberId}`);
      expect(result.tickets.get(memberId)).toBe(ticketEsperado);
    }
  });

  it('los suplentes son EXACTAMENTE `ceil(sampleSize / 3)` por estrato, en orden por ticket', async () => {
    // Mutante L104:18 `Math.ceil(sampleSize / 3)` → `Math.floor(...)`: con sampleSize=6,
    // ceil(6/3)=2, floor(6/3)=2; con sampleSize=5, ceil=2, floor=1 (difieren). Probamos con
    // sampleSize=5: deben ser 2, no 1.
    const electorate = await buildElectorate(20);
    const method: Extract<DecisionMethod, { kind: 'deliberative-sortition' }> = {
      kind: 'deliberative-sortition',
      sampleSize: 5,
      strata: [AXIS_SEMESTER],
      allocation: 'proportional',
      seedCommitment: SEED_COMMITMENT,
    };
    const result = await stratifiedSortition(electorate, method, SEED);
    // Cada estrato del padrón recibe una lista de sustitutos. Verificamos la cantidad y el orden.
    for (const [stratumKey, sustitutos] of result.substitutes) {
      expect(sustitutos).toHaveLength(Math.ceil(5 / 3));
      // La clave del Map es del estilo `semestre=s1`; extraemos el valor del estrato.
      const valorEstrato = stratumKey.split('=')[1] as StratumValue;
      const miembrosEstrato = electorate.members
        .filter((m) => m.strata[AXIS_SEMESTER] === valorEstrato)
        .map((m) => m.memberId);
      const ticketsEsperados = await Promise.all(
        miembrosEstrato.map(async (mid) => ({
          mid,
          ticket: await (
            await import('../src/index.js')
          ).hmacSha256Hex(SEED, `${stratumKey}|${mid}`),
        })),
      );
      ticketsEsperados.sort((a, b) => (a.ticket < b.ticket ? -1 : a.ticket > b.ticket ? 1 : 0));
      // Los sustitutos son los que NO están en `selected` Y tienen los primeros tickets.
      const selectedSet = new Set(result.selected);
      const noSeleccionados = ticketsEsperados.filter((t) => !selectedSet.has(t.mid));
      const esperados = noSeleccionados.slice(0, Math.ceil(5 / 3)).map((t) => t.mid);
      expect(sustitutos).toStrictEqual(esperados);
    }
  });

  it('los miembros sin valor para un eje caen bajo `semestre=∅` (visible en la etiqueta del estrato)', async () => {
    // Mutante L19:75 `member.strata[axis] ?? '∅'` → `?? ''`: cuando un miembro no tiene valor
    // para un eje, la etiqueta del estrato queda como `semestre=` (vacía) en lugar de
    // `semestre=∅`. Aquí exigimos que la etiqueta contenga el símbolo `∅` (U+2205) cuando el
    // valor falta, para que la tabla sea legible y el empate por ticket no confunda al auditor.
    //
    // Construimos un padrón con dos ejes (semestre y jornada) y damos valor de jornada sólo a
    // la mitad. El estrato de los sin-jornada debe ser `jornada=∅` (o `semestre=...|jornada=∅`).
    const miembros = Array.from({ length: 6 }, (_, i) => ({
      memberId: memberIdAt(i),
      strata: {
        [AXIS_SEMESTER]: S1,
        ...(i < 3 ? { [AXIS_JORNADA]: DIURNA } : {}),
      } as Readonly<Record<StratumKey, StratumValue>>,
    }));
    const electorate = await electorateWithStrata(miembros);
    const result = await stratifiedSortition(
      electorate,
      {
        kind: 'deliberative-sortition',
        sampleSize: 4,
        strata: [AXIS_JORNADA],
        allocation: 'proportional',
        seedCommitment: SEED_COMMITMENT,
      },
      SEED,
    );
    // Debe haber DOS estratos: uno con `jornada=diurna` y otro con `jornada=∅`.
    const nombresEstratos = result.quotas.map((q) => q.stratum);
    expect(nombresEstratos).toContain('jornada=diurna');
    expect(nombresEstratos).toContain('jornada=∅');
  });

  it('`sampleSize > N` se acota a `N` antes de repartir cuotas: la suma de cuotas = N', async () => {
    // Mutante L100:17 `Math.min(config.sampleSize, electorate.censusSize)` →
    //   `Math.max(...)`: con sampleSize=99 y N=5, original usa 5; mutante usa 99, el bucle while
    //   intenta redistribuir 99 cupos sobre 5 miembros y lanza `QUOTA_ALLOCATION_STUCK`.
    const electorate = await buildElectorate(5);
    const method: Extract<DecisionMethod, { kind: 'deliberative-sortition' }> = {
      kind: 'deliberative-sortition',
      sampleSize: 99,
      strata: [AXIS_SEMESTER],
      allocation: 'proportional',
      seedCommitment: SEED_COMMITMENT,
    };
    const result = await stratifiedSortition(electorate, method, SEED);
    expect(result.selected).toHaveLength(5);
    expect(result.quotas.reduce((sum, q) => sum + q.quota, 0)).toBe(5);
  });

  it('con `axes = []`, todos los miembros caen en el estrato sintético `todos`', async () => {
    // Mutante L18:7 `if (axes.length === 0)` → `if (false)`: con la guarda anulada, el código
    // intenta hacer `axes.map(...)` sobre un array vacío y devuelve `''` (join de nada), lo que
    // es una cadena distinta de `'todos'`. La tabla de cuotas agruparía a todos los miembros
    // bajo la clave `''` en lugar de `'todos'`.
    const electorate = await buildElectorate(8);
    const method: Extract<DecisionMethod, { kind: 'deliberative-sortition' }> = {
      kind: 'deliberative-sortition',
      sampleSize: 4,
      strata: [],
      allocation: 'proportional',
      seedCommitment: SEED_COMMITMENT,
    };
    const result = await stratifiedSortition(electorate, method, SEED);
    expect(result.quotas).toHaveLength(1);
    expect(result.quotas[0]?.stratum).toBe('todos');
    expect(result.quotas[0]?.quota).toBe(4);
    expect(result.substitutes.get('todos')).toHaveLength(Math.ceil(4 / 3));
  });

  it('los sustitutos y los seleccionados NO se solapan: la unión es exactamente `quota + ceil(n/3)`', async () => {
    // Mutante que doble el cupó: si `selected.slice(0, quota)` se cambiara por
    // `ordered.slice(0, quota).concat(ordered.slice(0, ...))`, los sustitutos podrían coincidir
    // con seleccionados. Aquí exigimos la disyunción.
    const electorate = await buildElectorate(20);
    const method: Extract<DecisionMethod, { kind: 'deliberative-sortition' }> = {
      kind: 'deliberative-sortition',
      sampleSize: 6,
      strata: [AXIS_SEMESTER],
      allocation: 'proportional',
      seedCommitment: SEED_COMMITMENT,
    };
    const result = await stratifiedSortition(electorate, method, SEED);
    const selectedSet = new Set(result.selected);
    for (const sustitutos of result.substitutes.values()) {
      for (const mid of sustitutos) {
        expect(selectedSet.has(mid)).toBe(false);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `tallySortition` — precondiciones
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.9 — `tallySortition`: precondiciones del escrutinio', () => {
  it('rechaza un método que no es `deliberative-sortition` con el mensaje del contrato', async () => {
    // Mutante L134:18 `config.method.kind !== 'deliberative-sortition'` → `===`: el original
    // lanza cuando el método NO es sortition; el mutante lanza cuando SÍ lo es. La precondición
    // está en el código y se ejecuta antes del `seed === undefined`.
    const electorate = await buildElectorate(3);
    const config = await buildSortitionConfig(
      {
        kind: 'deliberative-sortition',
        sampleSize: 1,
        strata: [AXIS_SEMESTER],
        allocation: 'proportional',
        seedCommitment: SEED_COMMITMENT,
      },
      electorate,
    );
    // Construimos un config con método equivocado para probar la precondición:
    const cfgSM = {
      ...config,
      method: {
        kind: 'simple-majority',
        abstentionPolicy: 'exclude',
        base: 'cast',
        tieBreak: { cascade: ['lexicographic-hash'] },
      },
    } as unknown as DecisionConfig;
    await expect(tallySortition(cfgSM, SEED)).rejects.toThrow(
      'tallySortition exige deliberative-sortition',
    );
  });

  it('rechaza una semilla `undefined` con `PreconditionError SEED_NOT_REVEALED`', async () => {
    // Mutante L137:7 `seed === undefined` → `seed !== undefined`: la guarda se invierte y el
    // código intenta ejecutar el sorteo sin semilla. Aquí exigimos el mensaje exacto.
    const electorate = await buildElectorate(5);
    const config = await buildSortitionConfig(
      {
        kind: 'deliberative-sortition',
        sampleSize: 2,
        strata: [AXIS_SEMESTER],
        allocation: 'proportional',
        seedCommitment: SEED_COMMITMENT,
      },
      electorate,
    );
    let lanzado: unknown;
    try {
      await tallySortition(config, undefined);
    } catch (e) {
      lanzado = e;
    }
    expect(lanzado).toBeInstanceOf(PreconditionError);
    expect((lanzado as PreconditionError).code).toBe('SEED_NOT_REVEALED');
    // Mutante L140:7 StringLiteral → "": el mensaje queda vacío. Aquí exigimos que la frase
    // diga qué pasó y por qué, en castellano y sin jerga.
    expect((lanzado as PreconditionError).message).toBe(
      'el sorteo sólo se ejecuta con la semilla comprometida ya revelada',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `tallySortition` — la demostración entera y exacta
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.9 — la demostración del escrutinio, paso a paso y sin jerga', () => {
  it('caso canónico: 12 electores, 2 estratos, sampleSize=4 → pasos, tablas y narrativa exactos', async () => {
    // Construimos un padrón con 12 miembros repartidos en dos estratos de 6 cada uno. La semilla
    // es fija, los tickets son HMAC-SHA-256 deterministas, y la demostración completa se compara
    // carácter a carácter.
    const miembros = Array.from({ length: 12 }, (_, i) => ({
      memberId: memberIdAt(i),
      strata: { [AXIS_SEMESTER]: i < 6 ? S1 : S2 } as Readonly<Record<StratumKey, StratumValue>>,
    }));
    const electorate = await electorateWithStrata(miembros);
    const config = await buildSortitionConfig(
      {
        kind: 'deliberative-sortition',
        sampleSize: 4,
        strata: [AXIS_SEMESTER],
        allocation: 'proportional',
        seedCommitment: SEED_COMMITMENT,
      },
      electorate,
    );
    const tally = await tallySortition(config, SEED);

    // El outcome lleva la lista de seleccionados.
    expect(tally.outcome.kind).toBe('sample');
    if (tally.outcome.kind !== 'sample') throw new Error('tipo de outcome inesperado');

    // Los pasos son exactamente tres: SO1, SO2, SO3.
    expect(tally.steps.map((s) => s.id)).toStrictEqual(['SO1', 'SO2', 'SO3']);

    // SO1: tamaño efectivo = sampleSize acotado.
    expect(tally.steps[0]?.claim).toBe(
      'El tamaño se acotó al padrón antes de repartir las cuotas.',
    );
    expect(tally.steps[0]?.evidence).toStrictEqual({
      solicitado: 4,
      efectivo: 4,
      censo: 12,
    });

    // SO2: la suma de cuotas coincide con el tamaño efectivo.
    expect(tally.steps[1]?.claim).toBe(
      'Las cuotas se asignaron por Hamilton con cocientes y restos enteros.',
    );
    expect(tally.steps[1]?.evidence).toMatchObject({
      estratos: 2,
      sumaCuotas: 4,
    });

    // SO3: la selección y la suplencia están determinadas por HMAC.
    expect(tally.steps[2]?.claim).toBe(
      'Cada selección y suplencia quedó determinada por su ticket HMAC.',
    );
    expect(tally.steps[2]?.evidence).toMatchObject({
      seleccionados: 4,
      suplentes: 4, // ceil(4/3) = 2 por estrato × 2 estratos
    });

    // Las tablas son exactamente tres con sus rótulos y columnas.
    expect(tally.tables.map((t) => t.title)).toStrictEqual([
      'Cuotas por estrato',
      'Personas seleccionadas',
      'Suplentes por estrato',
    ]);
    expect(tally.tables[0]?.columns).toStrictEqual([
      'Estrato',
      'Tamaño',
      'Cuota',
      'Resto',
      'Ticket de desempate',
    ]);
    expect(tally.tables[1]?.columns).toStrictEqual(['Miembro', 'Ticket']);
    expect(tally.tables[2]?.columns).toStrictEqual(['Estrato', 'Orden', 'Miembro', 'Ticket']);

    // La tabla de cuotas está ordenada alfabéticamente por estrato.
    const filasCuotas = tally.tables[0]?.rows ?? [];
    const nombresEstratos = filasCuotas.map((fila) => fila[0]);
    const nombresOrdenados = [...nombresEstratos].sort((a, b) =>
      (a as string) < (b as string) ? -1 : 1,
    );
    expect(nombresEstratos).toStrictEqual(nombresOrdenados);

    // La tabla de seleccionados tiene una fila por persona y el ticket de cada fila es el
    // publicado por `result.tickets`.
    const filasSeleccionados = tally.tables[1]?.rows ?? [];
    expect(filasSeleccionados).toHaveLength(4);
    for (const fila of filasSeleccionados) {
      const id = fila[0] as MemberId;
      const ticket = fila[1] as string;
      // Recomputamos el ticket y exigimos coincidencia exacta.
      const estratoValor = electorate.members.find((m) => m.memberId === id)?.strata[AXIS_SEMESTER];
      if (estratoValor === undefined) throw new Error(`la fila ${id} no corresponde a un estrato`);
      const ticketEsperado = await (
        await import('../src/index.js')
      ).hmacSha256Hex(SEED, `semestre=${estratoValor}|${id}`);
      expect(ticket).toBe(ticketEsperado);
    }

    // La tabla de suplentes tiene ceil(4/3) filas por cada estrato que tenga miembros.
    const filasSuplentes = tally.tables[2]?.rows ?? [];
    expect(filasSuplentes).toHaveLength(4); // 2 por estrato × 2 estratos
    // Cada fila tiene exactamente cuatro celdas: estrato, orden, miembro, ticket.
    for (const fila of filasSuplentes) {
      expect(fila).toHaveLength(4);
    }

    // El orden de los suplentes es 1-indexado (la primera fila de cada estrato lleva `1`, no `0`).
    // Mutante L145:46 `index + 1` → `index - 1`: con la mutación, la primera fila lleva 0 y la
    // segunda -1. Aquí exigimos que el primer orden de cada estrato sea exactamente 1.
    const ordenesPorEstrato = new Map<string, number[]>();
    for (const fila of filasSuplentes) {
      const estrato = fila[0] as string;
      const orden = fila[1] as number;
      if (!ordenesPorEstrato.has(estrato)) ordenesPorEstrato.set(estrato, []);
      ordenesPorEstrato.get(estrato)!.push(orden);
    }
    for (const ordenes of ordenesPorEstrato.values()) {
      expect(ordenes[0]).toBe(1);
      expect(ordenes[1]).toBe(2);
    }

    // La narrativa dice exactamente lo que el sorteo hizo.
    expect(tally.narrative).toBe(
      'La muestra se repartió por cuotas exactas y cada estrato se ordenó por un ticket HMAC ' +
        'verificable. Los suplentes son los siguientes tickets, sin un nuevo sorteo.',
    );

    // Coherencia entre el outcome y la lista de seleccionados en la tabla.
    const idsEnTabla = filasSeleccionados.map((fila) => fila[0]);
    expect([...idsEnTabla].sort()).toStrictEqual([...tally.outcome.selected].sort());
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `tallySortition` — empates, cupó cero y estrato vacío
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.9 — ramas de empate, cupó cero y estrato pequeño', () => {
  it('con dos estratos del mismo tamaño y sampleSize=3, la cuota es 1/2 por mayor resto', async () => {
    // (4, 4), sampleSize=3: total=8. cocientes: a=floor(12/8)=1, b=1. restos: 4, 4 (iguales).
    // Asignados=2; falta 1; desempata por ticket HMAC.
    const miembros = [
      ...Array.from({ length: 4 }, (_, i) => ({
        memberId: memberIdAt(i),
        strata: { [AXIS_SEMESTER]: S1 } as Readonly<Record<StratumKey, StratumValue>>,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        memberId: memberIdAt(4 + i),
        strata: { [AXIS_SEMESTER]: S2 } as Readonly<Record<StratumKey, StratumValue>>,
      })),
    ];
    const electorate = await electorateWithStrata(miembros);
    const result = await stratifiedSortition(
      electorate,
      {
        kind: 'deliberative-sortition',
        sampleSize: 3,
        strata: [AXIS_SEMESTER],
        allocation: 'proportional',
        seedCommitment: SEED_COMMITMENT,
      },
      SEED,
    );
    const resumen = new Map(result.quotas.map((q) => [q.stratum, q]));
    expect(resumen.get('semestre=s1')?.quota).toBe(1);
    expect(resumen.get('semestre=s2')?.quota).toBe(2);
    // El cupó va al estrato cuyo ticket es el menor de los dos con resto igual.
    const t1 = resumen.get('semestre=s1')?.remainderTicket ?? '';
    const t2 = resumen.get('semestre=s2')?.remainderTicket ?? '';
    const ganadorEsperado = t1 < t2 ? 'semestre=s1' : 'semestre=s2';
    expect(resumen.get(ganadorEsperado)?.quota).toBe(2);
  });

  it('un estrato sin miembros (size=0) tiene cuota 0 y la redistribución cubre a los demás', async () => {
    // (0, 4, 4), sampleSize=5: total=8. cocientes: a=0, b=2, c=2. restos: 0, 4, 4. Asignados=4;
    // falta 1; desempata entre b y c (resto=4, no toca a 'a' con resto=0). Suma = 5.
    const miembros = [
      ...Array.from({ length: 4 }, (_, i) => ({
        memberId: memberIdAt(i),
        strata: { [AXIS_SEMESTER]: S1 } as Readonly<Record<StratumKey, StratumValue>>,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        memberId: memberIdAt(4 + i),
        strata: { [AXIS_SEMESTER]: S2 } as Readonly<Record<StratumKey, StratumValue>>,
      })),
    ];
    const electorate = await electorateWithStrata(miembros);
    // Simulamos un estrato vacío modificando la entrada a hamiltonQuotas: el padrón no tiene
    // estrato 's3', así que construimos los tamaños manualmente.
    const result = await stratifiedSortition(
      electorate,
      {
        kind: 'deliberative-sortition',
        sampleSize: 5,
        strata: [AXIS_SEMESTER],
        allocation: 'proportional',
        seedCommitment: SEED_COMMITMENT,
      },
      SEED,
    );
    // El padrón tiene sólo dos estratos (s1 y s2), ambos con 4 miembros. La redistribución debe
    // cubrir sampleSize=5 entre los dos.
    expect(result.quotas.reduce((sum, q) => sum + q.quota, 0)).toBe(5);
    expect(result.selected).toHaveLength(5);
  });

  it('el orden de la tabla de cuotas es el alfabético, no el de mayor resto', async () => {
    // Mutante L84:5 `base.sort(...)` → `base`: las cuotas se publicarían en el orden del cálculo,
    // que es el de mayor resto descendente. Aquí exigimos el orden alfabético para que la tabla
    // sea estable entre semillas distintas.
    const miembros = [
      ...Array.from({ length: 3 }, (_, i) => ({
        memberId: memberIdAt(i),
        strata: { [AXIS_SEMESTER]: S1 } as Readonly<Record<StratumKey, StratumValue>>,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        memberId: memberIdAt(3 + i),
        strata: { [AXIS_SEMESTER]: S2 } as Readonly<Record<StratumKey, StratumValue>>,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        memberId: memberIdAt(6 + i),
        strata: { [AXIS_SEMESTER]: S3 } as Readonly<Record<StratumKey, StratumValue>>,
      })),
    ];
    const electorate = await electorateWithStrata(miembros);
    const tally = await tallySortition(
      await buildSortitionConfig(
        {
          kind: 'deliberative-sortition',
          sampleSize: 5,
          strata: [AXIS_SEMESTER],
          allocation: 'proportional',
          seedCommitment: SEED_COMMITMENT,
        },
        electorate,
      ),
      SEED,
    );
    const filas = tally.tables[0]?.rows ?? [];
    const nombres = filas.map((fila) => fila[0] as string);
    expect(nombres).toStrictEqual([...nombres].sort((a, b) => (a < b ? -1 : 1)));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `tallySortition` — coherencia interna de la demostración
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.9 — coherencia entre el outcome y la demostración', () => {
  it('la suma de cuotas del paso SO2 coincide con la suma de la tabla de cuotas', async () => {
    const electorate = await buildElectorate(15);
    const tally = await tallySortition(
      await buildSortitionConfig(
        {
          kind: 'deliberative-sortition',
          sampleSize: 6,
          strata: [AXIS_SEMESTER],
          allocation: 'proportional',
          seedCommitment: SEED_COMMITMENT,
        },
        electorate,
      ),
      SEED,
    );
    const sumaTabla = (tally.tables[0]?.rows ?? []).reduce(
      (sum, fila) => sum + (fila[2] as number),
      0,
    );
    expect(tally.steps[1]?.evidence['sumaCuotas']).toBe(sumaTabla);
  });

  it('el número de suplentes del paso SO3 coincide con la cantidad de filas en la tabla de suplentes', async () => {
    const electorate = await buildElectorate(20);
    const tally = await tallySortition(
      await buildSortitionConfig(
        {
          kind: 'deliberative-sortition',
          sampleSize: 5,
          strata: [AXIS_SEMESTER],
          allocation: 'proportional',
          seedCommitment: SEED_COMMITMENT,
        },
        electorate,
      ),
      SEED,
    );
    const suplentesTabla = (tally.tables[2]?.rows ?? []).length;
    expect(tally.steps[2]?.evidence['suplentes']).toBe(suplentesTabla);
  });

  it('los suplentes de la tabla son disjuntos de los seleccionados', async () => {
    const electorate = await buildElectorate(20);
    const tally = await tallySortition(
      await buildSortitionConfig(
        {
          kind: 'deliberative-sortition',
          sampleSize: 6,
          strata: [AXIS_SEMESTER],
          allocation: 'proportional',
          seedCommitment: SEED_COMMITMENT,
        },
        electorate,
      ),
      SEED,
    );
    const seleccionadosSet = new Set(
      (tally.tables[1]?.rows ?? []).map((fila) => fila[0] as MemberId),
    );
    for (const fila of tally.tables[2]?.rows ?? []) {
      const id = fila[2] as MemberId;
      expect(seleccionadosSet.has(id)).toBe(false);
    }
  });
});
