/**
 * Grafo de delegación: ámbitos, vigencia, aristas, cadenas y ciclos (PARTE C.2–C.4).
 *
 * `delegation.test.ts` prueba la RESOLUCIÓN completa (PASO 1-6) contra papeletas y una
 * `DecisionConfig` real; `delegation-engine.test.ts` la prueba de extremo a extremo con el motor.
 * Ninguno de los dos ejercita, uno por uno, cada PRIMITIVA de la que esa resolución depende —y es
 * justo lo que `docs/TESTING.md` §10 pide para código «denso en decisiones y pobre en efectos»: si
 * mutar el signo de una comparación de vigencia aquí no rompe nada, la única señal sería un
 * escenario de más arriba que tal vez ni pase por esa rama. Este fichero prueba las primitivas en
 * su propia frontera.
 *
 * `selectActiveDelegation` y `firstActiveInstant` no se reexportan por `src/index.ts` —son
 * herramientas internas del módulo, no API pública del paquete—, así que se importan del fichero
 * directamente, como ya hacen otros tests del paquete con `access.js`, `errors.js` o `ids.js`.
 */

import { describe, expect, it } from 'vitest';

import {
  compareDelegationPriority,
  type Delegation,
  type DelegationScope,
  delegationId,
  type DelegationId,
  findSupersededDelegation,
  type Instant,
  instant,
  isDelegationActive,
  isVigent,
  matchesScope,
  memberId,
  projectedRepresented,
  reachesInUnion,
  type ScopeSubject,
  scopeKey,
  scopeSpecificity,
  topicId,
  type TopicId,
  unionEdges,
  walkChain,
  wouldCreateCycle,
} from '../src/index.js';
import { firstActiveInstant, selectActiveDelegation } from '../src/delegation-graph.js';
import { circleIdAt, hex32 } from './arbitraries.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Fixtures
// ═════════════════════════════════════════════════════════════════════════════════════════════

const MEMBER_SPACE = 0x1000;
const TOPIC_SPACE = 0x8000;
const DELEGATION_SPACE = 0x7000;

const M = (i: number) => memberId(hex32(MEMBER_SPACE + i));
const topicIdAt = (i: number): TopicId => topicId(hex32(TOPIC_SPACE + i));
const delegationIdAt = (i: number): DelegationId => delegationId(hex32(DELEGATION_SPACE + i));

const CIRCULO = circleIdAt(0);
const OTRO_CIRCULO = circleIdAt(1);
const TOPIC_A = topicIdAt(0);
const TOPIC_B = topicIdAt(1);

const GLOBAL: DelegationScope = { kind: 'global' };
const EN_CIRCULO: DelegationScope = { kind: 'circle', circleId: CIRCULO };
const EN_OTRO_CIRCULO: DelegationScope = { kind: 'circle', circleId: OTRO_CIRCULO };
const SOBRE_A: DelegationScope = { kind: 'topic', topicId: TOPIC_A };
const SOBRE_B: DelegationScope = { kind: 'topic', topicId: TOPIC_B };

const T0 = instant(1_700_000_000_000);
const SEMESTER = 180 * 24 * 60 * 60 * 1000;

interface GrantSpec {
  readonly from: number;
  readonly to: number;
  readonly scope?: DelegationScope;
  readonly at?: Instant;
  readonly expiresAt?: Instant;
  readonly revokedAt?: Instant;
  readonly seq?: number;
}

/** Una delegación válida y completa; sólo se declara lo que cada prueba necesita variar. */
function grant(spec: GrantSpec, index: number): Delegation {
  const grantedAt = spec.at ?? instant(T0 + index);
  return {
    delegationId: delegationIdAt(index),
    delegator: M(spec.from),
    delegate: M(spec.to),
    scope: spec.scope ?? GLOBAL,
    grantedAt,
    expiresAt: spec.expiresAt ?? instant(grantedAt + SEMESTER),
    ...(spec.revokedAt === undefined ? {} : { revokedAt: spec.revokedAt }),
    grantedSeq: spec.seq ?? index + 1,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Ámbitos
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('scopeSpecificity — crece hacia abajo: global 0 < circle 1 < topic 2', () => {
  it('ordena los tres ámbitos exactamente así', () => {
    expect(scopeSpecificity(GLOBAL)).toBe(0);
    expect(scopeSpecificity(EN_CIRCULO)).toBe(1);
    expect(scopeSpecificity(SOBRE_A)).toBe(2);
  });
});

describe('scopeKey — la casilla única de C.1.b', () => {
  it('`global` es una clave fija', () => {
    expect(scopeKey(GLOBAL)).toBe('global');
  });

  it('`circle` lleva el `circleId` EXACTO: dos círculos no comparten casilla', () => {
    expect(scopeKey(EN_CIRCULO)).toBe(`circle:${CIRCULO}`);
    expect(scopeKey(EN_OTRO_CIRCULO)).toBe(`circle:${OTRO_CIRCULO}`);
    expect(scopeKey(EN_CIRCULO)).not.toBe(scopeKey(EN_OTRO_CIRCULO));
  });

  it('`topic` lleva el `topicId` EXACTO: dos temas no comparten casilla', () => {
    expect(scopeKey(SOBRE_A)).toBe(`topic:${TOPIC_A}`);
    expect(scopeKey(SOBRE_B)).toBe(`topic:${TOPIC_B}`);
    expect(scopeKey(SOBRE_A)).not.toBe(scopeKey(SOBRE_B));
  });
});

describe('matchesScope — C.2, y el fallo de INV-30 (pertenencia, no `topics[0]`)', () => {
  it('`global` casa con cualquier sujeto', () => {
    expect(matchesScope(GLOBAL, { circleId: CIRCULO, topics: [] })).toBe(true);
    expect(matchesScope(GLOBAL, { circleId: OTRO_CIRCULO, topics: [TOPIC_B] })).toBe(true);
  });

  it('`circle` casa sólo con el MISMO círculo', () => {
    expect(matchesScope(EN_CIRCULO, { circleId: CIRCULO, topics: [] })).toBe(true);
    expect(matchesScope(EN_CIRCULO, { circleId: OTRO_CIRCULO, topics: [] })).toBe(false);
  });

  it('`topic` casa por PERTENENCIA al conjunto, no por igualdad con `topics[0]` (INV-30)', () => {
    // El tema buscado es el SEGUNDO de la lista: si `matchesScope` comparara sólo con `topics[0]`
    // (el fallo ingenuo que INV-30 describe), esto daría `false` y sería el error exacto.
    expect(matchesScope(SOBRE_B, { circleId: CIRCULO, topics: [TOPIC_A, TOPIC_B] })).toBe(true);
    expect(matchesScope(SOBRE_B, { circleId: CIRCULO, topics: [TOPIC_A] })).toBe(false);
    expect(matchesScope(SOBRE_A, { circleId: CIRCULO, topics: [] })).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Vigencia
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('isVigent — los tres signos son estrictos (C.2)', () => {
  it('en el propio `grantedAt` TODAVÍA no es vigente; un milisegundo después, sí', () => {
    const d = grant({ from: 0, to: 1, at: T0, expiresAt: instant(T0 + 1000) }, 0);
    expect(isVigent(d, d.grantedAt)).toBe(false);
    expect(isVigent(d, instant(d.grantedAt + 1))).toBe(true);
  });

  it('en `expiresAt` exacto YA NO es vigente; un milisegundo antes, sí', () => {
    const d = grant({ from: 0, to: 1, at: T0, expiresAt: instant(T0 + 1000) }, 0);
    expect(isVigent(d, instant(d.expiresAt - 1))).toBe(true);
    expect(isVigent(d, d.expiresAt)).toBe(false);
  });

  it('sin revocar, `revokedAt` ausente no excluye nada', () => {
    const d = grant({ from: 0, to: 1, at: T0, expiresAt: instant(T0 + 1000) }, 0);
    expect(d.revokedAt).toBeUndefined();
    expect(isVigent(d, instant(T0 + 500))).toBe(true);
  });

  it('revocada, deja de ser vigente EN el instante mismo de la revocación (INV-24)', () => {
    const revocada = grant(
      { from: 0, to: 1, at: T0, expiresAt: instant(T0 + 10_000), revokedAt: instant(T0 + 500) },
      0,
    );
    expect(isVigent(revocada, instant(499 + T0))).toBe(true);
    expect(isVigent(revocada, instant(T0 + 500))).toBe(false);
  });
});

describe('firstActiveInstant', () => {
  it('es `grantedAt + 1`: en el propio `grantedAt` la delegación aún no cuenta', () => {
    const d = grant({ from: 0, to: 1, at: instant(5000), expiresAt: instant(6000) }, 0);
    expect(firstActiveInstant(d)).toBe(5001);
    expect(isVigent(d, d.grantedAt)).toBe(false);
    expect(isVigent(d, firstActiveInstant(d))).toBe(true);
  });
});

describe('isDelegationActive — vigencia Y ámbito (C.2)', () => {
  const d = grant({ from: 0, to: 1, scope: EN_CIRCULO, at: T0, expiresAt: instant(T0 + 1000) }, 0);
  const dentro: ScopeSubject = { circleId: CIRCULO, topics: [] };
  const fuera: ScopeSubject = { circleId: OTRO_CIRCULO, topics: [] };

  it('vigente y en ámbito: activa', () => {
    expect(isDelegationActive(d, instant(T0 + 1), dentro)).toBe(true);
  });

  it('vigente pero FUERA de ámbito: no activa', () => {
    expect(isDelegationActive(d, instant(T0 + 1), fuera)).toBe(false);
  });

  it('en ámbito pero NO vigente: no activa', () => {
    expect(isDelegationActive(d, d.grantedAt, dentro)).toBe(false);
    expect(isDelegationActive(d, d.expiresAt, dentro)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Selección
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('compareDelegationPriority — especificidad primero, recencia después (C.2)', () => {
  it('la más ESPECÍFICA gana, aunque sea más vieja', () => {
    const global = grant({ from: 0, to: 1, scope: GLOBAL, seq: 99 }, 0);
    const tema = grant({ from: 0, to: 2, scope: SOBRE_A, seq: 1 }, 1);
    expect(compareDelegationPriority(tema, global)).toBeLessThan(0);
    expect(compareDelegationPriority(global, tema)).toBeGreaterThan(0);
  });

  it('a igual especificidad, gana el `grantedSeq` MAYOR', () => {
    const vieja = grant({ from: 0, to: 1, seq: 3 }, 0);
    const nueva = grant({ from: 0, to: 2, seq: 7 }, 1);
    expect(compareDelegationPriority(nueva, vieja)).toBeLessThan(0);
    expect(compareDelegationPriority(vieja, nueva)).toBeGreaterThan(0);
  });

  it(
    'a igual especificidad y `grantedSeq`, el tercer criterio es `delegationId` — no lo alcanza ' +
      'ningún log legal, pero da orden TOTAL sobre datos fabricados a mano',
    () => {
      const a = { ...grant({ from: 0, to: 1, seq: 5 }, 0), delegationId: delegationIdAt(1) };
      const b = { ...grant({ from: 0, to: 2, seq: 5 }, 1), delegationId: delegationIdAt(2) };
      expect(compareDelegationPriority(a, b)).toBeLessThan(0);
      expect(compareDelegationPriority(b, a)).toBeGreaterThan(0);
      expect(compareDelegationPriority(a, a)).toBe(0);
    },
  );
});

describe('selectActiveDelegation', () => {
  it('sin ninguna activa, `undefined`', () => {
    expect(selectActiveDelegation([], M(0), T0, { circleId: CIRCULO, topics: [] })).toBeUndefined();
  });

  it('con varias activas del mismo delegante, la de mayor prioridad (C.2)', () => {
    const delegaciones = [
      grant({ from: 0, to: 1, scope: GLOBAL, at: T0, seq: 1 }, 0),
      grant({ from: 0, to: 2, scope: EN_CIRCULO, at: T0, seq: 1 }, 1),
    ];
    const elegida = selectActiveDelegation(delegaciones, M(0), instant(T0 + 1), {
      circleId: CIRCULO,
      topics: [],
    });
    expect(elegida?.delegate).toBe(M(2)); // «circle» es más específico que «global»
  });

  it('filtra de verdad: ignora lo de OTRO delegante y lo que no está vigente', () => {
    const delegaciones = [
      grant({ from: 9, to: 8, scope: GLOBAL, at: T0, seq: 1 }, 0), // otro delegante
      grant({ from: 0, to: 7, scope: GLOBAL, at: T0, expiresAt: instant(T0 + 10), seq: 1 }, 1), // mismo delegante, pero ya caducada en el instante de la consulta
      grant({ from: 0, to: 1, scope: GLOBAL, at: T0, seq: 1 }, 2), // la única que de verdad aplica
    ];
    const elegida = selectActiveDelegation(delegaciones, M(0), instant(T0 + 1000), {
      circleId: CIRCULO,
      topics: [],
    });
    expect(elegida?.delegate).toBe(M(1));
  });
});

describe('findSupersededDelegation — C.1.b', () => {
  it('sin ninguna previa vigente en esa casilla, `undefined`', () => {
    expect(findSupersededDelegation([], grant({ from: 0, to: 1 }, 0))).toBeUndefined();
  });

  it('encuentra la vigente del MISMO delegante y la MISMA casilla de ámbito', () => {
    const previa = grant({ from: 0, to: 1, scope: GLOBAL, at: T0 }, 0);
    const nueva = grant({ from: 0, to: 2, scope: GLOBAL, at: instant(T0 + 10_000) }, 1);
    expect(findSupersededDelegation([previa], nueva)?.delegationId).toBe(previa.delegationId);
  });

  it('un ámbito DISTINTO no se desplaza: dos casillas conviven', () => {
    const previa = grant({ from: 0, to: 1, scope: EN_CIRCULO, at: T0 }, 0);
    const nueva = grant({ from: 0, to: 2, scope: SOBRE_A, at: instant(T0 + 10_000) }, 1);
    expect(findSupersededDelegation([previa], nueva)).toBeUndefined();
  });

  it('una previa ya CADUCADA en el instante de la nueva no se desplaza: no había nada vigente', () => {
    const previa = grant(
      { from: 0, to: 1, scope: GLOBAL, at: T0, expiresAt: instant(T0 + 100) },
      0,
    );
    const nueva = grant({ from: 0, to: 2, scope: GLOBAL, at: instant(T0 + 10_000) }, 1);
    expect(findSupersededDelegation([previa], nueva)).toBeUndefined();
  });

  it('no se desplaza a sí misma por `delegationId`', () => {
    const d = grant({ from: 0, to: 1 }, 0);
    expect(findSupersededDelegation([d], d)).toBeUndefined();
  });

  it('una entrada con el MISMO `delegationId` que el candidato nunca es «la desplazada»', () => {
    // `delegations` documenta llegar SIN el candidato; esto es la misma defensa que las otras
    // comprobaciones EX ANTE: un log fabricado a mano no debe poder colar un id repetido y que el
    // dominio lo trate como si el candidato desplazara a una copia de sí mismo.
    const mismoId = delegationIdAt(9);
    const previa = { ...grant({ from: 0, to: 1, at: T0 }, 9), delegationId: mismoId };
    const candidata = {
      ...grant({ from: 0, to: 2, at: instant(T0 + 1000) }, 10),
      delegationId: mismoId,
    };
    expect(findSupersededDelegation([previa], candidata)).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Cadenas
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('walkChain — PASO 3 de C.3', () => {
  it('quien votó directo es terminal de sí mismo, con 0 saltos', () => {
    expect(
      walkChain(
        M(0),
        () => undefined,
        () => true,
        4,
      ),
    ).toEqual({
      kind: 'assigned',
      terminal: M(0),
      hops: 0,
    });
  });

  it('recorre una cadena hasta quien votó directo, contando ARISTAS y no nodos', () => {
    const edges = new Map([
      [M(0), M(1)],
      [M(1), M(2)],
      [M(2), M(3)],
    ]);
    const outcome = walkChain(
      M(0),
      (m) => edges.get(m),
      (m) => m === M(3),
      4,
    );
    expect(outcome).toEqual({ kind: 'assigned', terminal: M(3), hops: 3 });
  });

  it('sin arista de salida y sin voto directo: `no-delegation`, 0 saltos', () => {
    expect(
      walkChain(
        M(0),
        () => undefined,
        () => false,
        4,
      ),
    ).toEqual({
      kind: 'unassigned',
      reason: 'no-delegation',
      hops: 0,
    });
  });

  it('la cadena termina sin que nadie vote: `chain-dead-end`, con los saltos ya dados', () => {
    const edges = new Map([[M(0), M(1)]]);
    const outcome = walkChain(
      M(0),
      (m) => edges.get(m),
      () => false,
      4,
    );
    expect(outcome).toEqual({ kind: 'unassigned', reason: 'chain-dead-end', hops: 1 });
  });

  it('exactamente `maxDepth` aristas SÍ se admiten', () => {
    const edges = new Map([
      [M(0), M(1)],
      [M(1), M(2)],
      [M(2), M(3)],
      [M(3), M(4)],
    ]);
    const outcome = walkChain(
      M(0),
      (m) => edges.get(m),
      (m) => m === M(4),
      4,
    );
    expect(outcome).toEqual({ kind: 'assigned', terminal: M(4), hops: 4 });
  });

  it('la arista número `maxDepth + 1` se rechaza: `depth-exceeded`', () => {
    const edges = new Map([
      [M(0), M(1)],
      [M(1), M(2)],
      [M(2), M(3)],
      [M(3), M(4)],
      [M(4), M(5)],
    ]);
    const outcome = walkChain(
      M(0),
      (m) => edges.get(m),
      (m) => m === M(5),
      4,
    );
    expect(outcome).toEqual({ kind: 'unassigned', reason: 'depth-exceeded', hops: 5 });
  });

  it('un ciclo se detecta y NO cuelga el recorrido (INV-25)', () => {
    const edges = new Map([
      [M(0), M(1)],
      [M(1), M(2)],
      [M(2), M(0)],
    ]);
    const outcome = walkChain(
      M(0),
      (m) => edges.get(m),
      () => false,
      10,
    );
    expect(outcome).toEqual({ kind: 'unassigned', reason: 'cycle', hops: 3 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Grafo unión y comprobaciones EX ANTE
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('unionEdges — todas las salidas vigentes, de todo ámbito, a la vez', () => {
  it('un nodo puede tener varias salidas, una por ámbito', () => {
    const delegaciones = [
      grant({ from: 0, to: 1, scope: GLOBAL, at: T0 }, 0),
      grant({ from: 0, to: 2, scope: EN_CIRCULO, at: T0 }, 1),
    ];
    expect(unionEdges(delegaciones, instant(T0 + 1)).get(M(0))).toEqual([M(1), M(2)]);
  });

  it('excluye lo que no está vigente en `at`', () => {
    const delegaciones = [grant({ from: 0, to: 1, at: T0, expiresAt: instant(T0 + 100) }, 0)];
    expect(unionEdges(delegaciones, instant(T0 + 1)).get(M(0))).toEqual([M(1)]);
    expect(unionEdges(delegaciones, instant(T0 + 200)).has(M(0))).toBe(false);
  });

  it('el mismo delegado repetido en dos ámbitos no se duplica en la lista de salidas', () => {
    const delegaciones = [
      grant({ from: 0, to: 1, scope: EN_CIRCULO, at: T0 }, 0),
      grant({ from: 0, to: 1, scope: SOBRE_A, at: T0 }, 1),
    ];
    expect(unionEdges(delegaciones, instant(T0 + 1)).get(M(0))).toEqual([M(1)]);
  });
});

describe('reachesInUnion', () => {
  it('`from === target` es trivialmente alcanzable', () => {
    expect(reachesInUnion([], M(0), M(0), T0)).toBe(true);
  });

  it('alcanza en varios saltos', () => {
    const delegaciones = [
      grant({ from: 0, to: 1, at: T0 }, 0),
      grant({ from: 1, to: 2, at: T0 }, 1),
    ];
    expect(reachesInUnion(delegaciones, M(0), M(2), instant(T0 + 1))).toBe(true);
  });

  it('no alcanza lo inalcanzable', () => {
    const delegaciones = [grant({ from: 0, to: 1, at: T0 }, 0)];
    expect(reachesInUnion(delegaciones, M(0), M(9), instant(T0 + 1))).toBe(false);
  });

  it('un ciclo no cuelga el recorrido (INV-25)', () => {
    const delegaciones = [
      grant({ from: 0, to: 1, at: T0 }, 0),
      grant({ from: 1, to: 0, at: T0 }, 1),
    ];
    expect(reachesInUnion(delegaciones, M(0), M(9), instant(T0 + 1))).toBe(false);
  });

  it('tampoco cuelga con un ciclo que NO incluye a `from`, a dos saltos de distancia', () => {
    // `from` (M(0)) no es parte del ciclo: llega a él por una arista de entrada. Sin marcar cada
    // nodo visitado —no sólo `from`— el recorrido entre M(1) y M(2) no terminaría nunca.
    const delegaciones = [
      grant({ from: 0, to: 1, at: T0 }, 0),
      grant({ from: 1, to: 2, at: T0 }, 1),
      grant({ from: 2, to: 1, at: T0 }, 2),
    ];
    expect(reachesInUnion(delegaciones, M(0), M(9), instant(T0 + 1))).toBe(false);
  });
});

describe('wouldCreateCycle — C.4.1, se pregunta ANTES de añadir la arista', () => {
  it('la autodelegación es el caso degenerado: siempre `true`', () => {
    expect(wouldCreateCycle([], grant({ from: 0, to: 0, at: T0 }, 0))).toBe(true);
  });

  it('cierra un ciclo directo', () => {
    const existentes = [grant({ from: 1, to: 0, at: T0 }, 0)];
    const candidata = grant({ from: 0, to: 1, at: instant(T0 + 1000) }, 1);
    expect(wouldCreateCycle(existentes, candidata)).toBe(true);
  });

  it('cierra un ciclo TRANSITIVO que atraviesa la UNIÓN de ámbitos (errata E-37)', () => {
    const existentes = [
      grant({ from: 1, to: 2, scope: GLOBAL, at: T0 }, 0),
      grant({ from: 2, to: 0, scope: SOBRE_A, at: T0 }, 1),
    ];
    const candidata = grant({ from: 0, to: 1, scope: EN_CIRCULO, at: instant(T0 + 1000) }, 2);
    expect(wouldCreateCycle(existentes, candidata)).toBe(true);
  });

  it('no cierra nada cuando el delegado es inalcanzable', () => {
    expect(wouldCreateCycle([], grant({ from: 0, to: 1, at: T0 }, 0))).toBe(false);
  });
});

describe('projectedRepresented — C.5.b.1, cota superior transitiva', () => {
  it('sin nadie delegando, vacío', () => {
    expect(projectedRepresented([], M(0), T0, 4)).toEqual([]);
  });

  it('encuentra delegantes DIRECTOS', () => {
    const delegaciones = [grant({ from: 1, to: 0, at: T0 }, 0)];
    expect(projectedRepresented(delegaciones, M(0), instant(T0 + 1), 4)).toEqual([M(1)]);
  });

  it('encuentra cadenas TRANSITIVAS, en orden canónico', () => {
    const delegaciones = [
      grant({ from: 2, to: 1, at: T0 }, 0),
      grant({ from: 1, to: 0, at: T0 }, 1),
    ];
    expect(projectedRepresented(delegaciones, M(0), instant(T0 + 1), 4)).toEqual([M(1), M(2)]);
  });

  it('no cruza más allá de `maxDepth`', () => {
    const delegaciones = [
      grant({ from: 3, to: 2, at: T0 }, 0),
      grant({ from: 2, to: 1, at: T0 }, 1),
      grant({ from: 1, to: 0, at: T0 }, 2),
    ];
    expect(projectedRepresented(delegaciones, M(0), instant(T0 + 1), 2)).toEqual([M(1), M(2)]);
    expect(projectedRepresented(delegaciones, M(0), instant(T0 + 1), 3)).toEqual([
      M(1),
      M(2),
      M(3),
    ]);
  });

  it('nunca incluye al propio delegado', () => {
    const delegaciones = [grant({ from: 1, to: 0, at: T0 }, 0)];
    expect(projectedRepresented(delegaciones, M(0), instant(T0 + 1), 4)).not.toContain(M(0));
  });

  it('ni siquiera cuando un ciclo trae de vuelta al propio delegado (M(0) ↔ M(1))', () => {
    // Sin la semilla de `seen` en el propio `delegate`, un ciclo que vuelve a él lo redescubriría
    // como si fuera un delegante más — justo lo que el comentario de la función promete que no pasa.
    const delegaciones = [
      grant({ from: 0, to: 1, at: T0 }, 0),
      grant({ from: 1, to: 0, at: T0 }, 1),
    ];
    expect(projectedRepresented(delegaciones, M(0), instant(T0 + 1), 4)).not.toContain(M(0));
  });

  it('excluye lo que no está VIGENTE en `at`, aunque haya estado vigente antes', () => {
    const delegaciones = [
      grant({ from: 1, to: 0, at: T0, expiresAt: instant(T0 + 100) }, 0), // caducada
      grant({ from: 2, to: 0, at: T0 }, 1), // vigente
    ];
    expect(projectedRepresented(delegaciones, M(0), instant(T0 + 200), 4)).toEqual([M(2)]);
  });

  it('un delegante con DOS ámbitos hacia el mismo destino cuenta UNA sola vez', () => {
    const delegaciones = [
      grant({ from: 1, to: 0, scope: EN_CIRCULO, at: T0 }, 0),
      grant({ from: 1, to: 0, scope: SOBRE_A, at: T0 }, 1),
    ];
    expect(projectedRepresented(delegaciones, M(0), instant(T0 + 1), 4)).toEqual([M(1)]);
  });

  it('un DIAMANTE (dos caminos hasta el mismo delegante) no lo duplica', () => {
    // M(0) ← M(1) ← M(3) y M(0) ← M(2) ← M(3): M(3) llega por dos rutas y debe contarse una vez.
    const delegaciones = [
      grant({ from: 1, to: 0, at: T0 }, 0),
      grant({ from: 2, to: 0, at: T0 }, 1),
      grant({ from: 3, to: 1, scope: EN_CIRCULO, at: T0 }, 2),
      grant({ from: 3, to: 2, scope: SOBRE_A, at: T0 }, 3),
    ];
    const resultado = projectedRepresented(delegaciones, M(0), instant(T0 + 1), 4);
    expect(resultado).toEqual([M(1), M(2), M(3)]);
    expect(new Set(resultado).size).toBe(resultado.length);
  });

  it('el resultado sale ORDENADO aunque el descubrimiento no lo esté', () => {
    // M(5) se concede ANTES que M(1) en el arreglo, así que si algo dependiera del orden de
    // descubrimiento en vez de ordenar al final, este caso daría `[M(5), M(1)]`.
    const delegaciones = [
      grant({ from: 5, to: 0, at: T0 }, 0),
      grant({ from: 1, to: 0, at: T0 }, 1),
    ];
    expect(projectedRepresented(delegaciones, M(0), instant(T0 + 1), 4)).toEqual([M(1), M(5)]);
  });
});
