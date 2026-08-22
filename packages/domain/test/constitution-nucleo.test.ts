/**
 * El núcleo intangible, probado donde importa: **en el pliegue**.
 *
 * ═══ Por qué estas pruebas no llaman a las órdenes ═══
 *
 * Que `openReform` rechace una reforma que toca el núcleo no prueba gran cosa: prueba que **una**
 * puerta está cerrada. El adversario del §7 no entra por ahí. Entra con un historial entero traído
 * de fuera —una restauración, un volcado, un fichero—, con todos los hashes recalculados y la cadena
 * impecable, porque él tiene la base de datos y puede rehacerla.
 *
 * Así que aquí se **fabrican esos historiales**: se toma uno legítimo, se altera un evento y se
 * vuelve a encadenar desde ahí con `appendChained`, que es exactamente lo que haría quien tuviera el
 * servidor. El resultado pasa `verifyChain` sin una sola queja —la cadena está perfecta— y aun así
 * `replayConstitution` lo rechaza. Esa es la garantía: no «la orden lo impide», sino **el pliegue lo
 * rechaza**.
 *
 * ═══ Y el límite, que también se prueba ═══
 *
 * Hay un forjado que el pliegue **no** puede detectar: reescribir el evento fundacional entero, el
 * núcleo y el texto a la vez. El pliegue compara contra el génesis; si el génesis miente, miente el
 * patrón de comparación. Eso lo detecta el hash del núcleo publicado y anclado fuera del servidor
 * (`verifyConstitutionLog(log, { expectedCoreHash })`), y hay una prueba que lo demuestra en las dos
 * direcciones: el historial legítimo verifica, el reescrito no.
 */

import { describe, expect, it } from 'vitest';

import type { Actor } from '../src/access.js';
import {
  approveReform,
  assertCoreIntact,
  applyConstitution,
  type Clause,
  type ConstitutionLog,
  type ConstitutionPayload,
  type ConstitutionText,
  constitutionCoreHash,
  constitutionId,
  CORE_CLAUSE_IDS,
  CoreAlteredError,
  coreProjection,
  ENTRENCHED_REFORM_V1,
  foundConstitution,
  initialConstitutionState,
  openReform,
  ORDINARY_REFORM_V1,
  ratifyReform,
  recordReformVote,
  reformId,
  replayConstitution,
  verifyConstitutionLog,
} from '../src/constitution/index.js';
import {
  circleId,
  decisionId,
  eventId,
  type EventId,
  hash,
  type Instant,
  instant,
  type MemberId,
  memberId,
} from '../src/ids.js';
import { appendChained, verifyChain } from '../src/workspace/chain.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Escenario (deliberadamente repetido: `test/constitution*.test.ts` es una lista cerrada)
// ═════════════════════════════════════════════════════════════════════════════════════════════

const hex32 = (n: number): string => n.toString(16).padStart(32, '0');
const hex64 = (n: number): string => n.toString(16).padStart(64, '0');

const CONSTI = constitutionId(hex32(0xc0));
const CIRCULO = circleId(hex32(0xc1));
const mid = (n: number): MemberId => memberId(hex32(0x1000 + n));
const ev = (log: ConstitutionLog): EventId => eventId(hex32(0x6000 + log.length + 1));

const DIA = 86_400_000;
const T0 = 1_700_000_000_000 as Instant;
const en = (dias: number): Instant => instant(T0 + dias * DIA);

const facilitadora: Actor = { memberId: mid(1), roles: ['facilitator'], circles: [CIRCULO] };
const miembro: Actor = { memberId: mid(30), roles: ['member'], circles: [CIRCULO] };
const GARANTES: readonly MemberId[] = [mid(20), mid(21), mid(22), mid(23), mid(24)];
const garante = (i: number): Actor => ({
  memberId: GARANTES[i],
  roles: ['guarantees'],
  circles: [CIRCULO],
});

const REFORMA = reformId(hex32(0xf1));

const NUCLEO: readonly Clause[] = CORE_CLAUSE_IDS.map((id, i) => ({
  clauseId: id,
  textHash: hash(hex64(0x100 + i)),
}));

function ordenar(clauses: readonly Clause[]): readonly Clause[] {
  return [...clauses].sort((a, b) =>
    a.clauseId < b.clauseId ? -1 : a.clauseId > b.clauseId ? 1 : 0,
  );
}

const EXTRAS: readonly Clause[] = [
  { clauseId: 'metodo_de_escrutinio' as Clause['clauseId'], textHash: hash(hex64(0x200)) },
  { clauseId: 'plazos_de_fase' as Clause['clauseId'], textHash: hash(hex64(0x201)) },
];

const TEXTO: ConstitutionText = {
  clauses: ordenar([...NUCLEO, ...EXTRAS]),
  ordinary: ORDINARY_REFORM_V1,
  entrenched: ENTRENCHED_REFORM_V1,
  validityMonths: 12,
};

/** Sustituye el hash de una cláusula, en el texto y —si se pide— también en el núcleo declarado. */
function conClausulaCambiada(
  text: ConstitutionText,
  clause: string,
  nuevo: string,
): ConstitutionText {
  return {
    ...text,
    clauses: text.clauses.map((c) => (c.clauseId === clause ? { ...c, textHash: hash(nuevo) } : c)),
  };
}

async function fundar(): Promise<ConstitutionLog> {
  return foundConstitution(
    [],
    { eventId: ev([]), at: T0, actor: facilitadora },
    {
      constitutionId: CONSTI,
      text: TEXTO,
      core: NUCLEO,
      foundingDecisionId: decisionId(hex32(0xd1)),
      censusSize: 300,
      castBallots: 150,
      votesInFavor: 100,
      directParticipation: 100,
      effectiveAt: T0,
    },
  );
}

/** Reforma ordinaria completa y legítima: cambia `metodo_de_escrutinio` y nada más. */
async function reformaCompleta(): Promise<ConstitutionLog> {
  let log = await fundar();
  log = await openReform(
    log,
    { eventId: ev(log), at: en(1), actor: miembro },
    {
      reformId: REFORMA,
      kind: 'ordinaria',
      targetVersion: 1,
      proposedText: conClausulaCambiada(TEXTO, 'metodo_de_escrutinio', hex64(0x2000)),
      censusSize: 300,
      guarantors: GARANTES,
      calendar: { semesterEndsAt: en(300), convened: [] },
      sponsorCount: 30,
      deliberationOpensAt: en(1),
      deliberationClosesAt: en(22),
    },
  );
  log = await recordReformVote(
    log,
    { eventId: ev(log), at: en(29), actor: facilitadora },
    {
      reformId: REFORMA,
      vote: {
        round: 1,
        decisionId: decisionId(hex32(0xd3)),
        votesInFavor: 200,
        directParticipation: 100,
        opensAt: en(22),
        closesAt: en(29),
      },
    },
  );
  for (const i of [0, 1, 2]) {
    log = await approveReform(
      log,
      { eventId: ev(log), at: en(30), actor: garante(i) },
      { reformId: REFORMA },
    );
  }
  return ratifyReform(
    log,
    { eventId: ev(log), at: en(43), actor: facilitadora },
    { reformId: REFORMA, effectiveAt: en(43) },
  );
}

/**
 * **La herramienta del adversario.** Cambia el payload del evento `indice` y vuelve a encadenar
 * todo lo que viene detrás, con los mismos identificadores, actores e instantes.
 *
 * El resultado es un historial cuya cadena de hashes es impecable: es lo que puede hacer quien
 * tiene la base de datos. Nada de esto rompe `verifyChain`, y por eso `verifyChain` no basta.
 */
async function reencadenar(
  log: ConstitutionLog,
  indice: number,
  payload: ConstitutionPayload,
): Promise<ConstitutionLog> {
  let out: ConstitutionLog = log.slice(0, indice);
  for (let i = indice; i < log.length; i++) {
    const original = log[i]!;
    const evento = await appendChained<ConstitutionPayload>(out, {
      eventId: original.eventId,
      aggregateId: original.aggregateId,
      occurredAt: original.occurredAt,
      actor: original.actor,
      payload: i === indice ? payload : original.payload,
    });
    out = [...out, evento];
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El pliegue rechaza el historial forjado
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('un historial forjado que altera el núcleo NO se pliega', () => {
  it('la cadena queda perfecta y aun así el pliegue lo rechaza', async () => {
    const legitimo = await reformaCompleta();
    await expect(verifyChain(legitimo)).resolves.toBeUndefined();
    expect(replayConstitution(legitimo).currentVersion).toBe(2);

    const indice = legitimo.findIndex((e) => e.payload.type === 'ReformOpened');
    const abierta = legitimo[indice]!.payload;
    if (abierta.type !== 'ReformOpened') throw new Error('escenario mal armado');

    // El administrador reescribe la reforma para que, al ratificarse, cambie de paso el texto de la
    // lista taxativa de la fila 20 —el punto (vi) del núcleo—. Recalcula todos los hashes.
    const forjado = await reencadenar(legitimo, indice, {
      ...abierta,
      proposedText: conClausulaCambiada(abierta.proposedText, 'lista_taxativa', hex64(0x666)),
    });

    // La cadena NO se queja: está bien construida.
    await expect(verifyChain(forjado)).resolves.toBeUndefined();
    expect(forjado).toHaveLength(legitimo.length);

    // El pliegue sí.
    expect(() => replayConstitution(forjado)).toThrow(
      expect.objectContaining({ code: 'CORE_CLAUSE_ALTERED' }),
    );
    await expect(verifyConstitutionLog(forjado)).rejects.toBeInstanceOf(CoreAlteredError);
    await expect(verifyConstitutionLog(forjado)).rejects.toMatchObject({
      violation: 'CORE_CLAUSE_ALTERED',
      clauseId: 'lista_taxativa',
    });
  });

  it('quitar del texto una cláusula del núcleo tampoco cuela', async () => {
    const legitimo = await reformaCompleta();
    const indice = legitimo.findIndex((e) => e.payload.type === 'ReformOpened');
    const abierta = legitimo[indice]!.payload;
    if (abierta.type !== 'ReformOpened') throw new Error('escenario mal armado');

    const sinNucleo: ConstitutionText = {
      ...abierta.proposedText,
      clauses: abierta.proposedText.clauses.filter((c) => c.clauseId !== 'derecho_a_exportar'),
    };
    const forjado = await reencadenar(legitimo, indice, {
      ...abierta,
      proposedText: sinNucleo,
    });

    await expect(verifyChain(forjado)).resolves.toBeUndefined();
    expect(() => replayConstitution(forjado)).toThrow(
      expect.objectContaining({ code: 'CORE_CLAUSE_MISSING' }),
    );
  });

  it('una refundación con otro núcleo se rechaza aunque la cadena esté intacta', async () => {
    const legitimo = await fundar();
    const caduca = replayConstitution(legitimo).versions[0]!.expiresAt;
    const refundada = await foundConstitution(
      legitimo,
      { eventId: ev(legitimo), at: caduca, actor: facilitadora },
      {
        constitutionId: CONSTI,
        text: TEXTO,
        core: NUCLEO,
        foundingDecisionId: decisionId(hex32(0xd9)),
        censusSize: 300,
        castBallots: 150,
        votesInFavor: 100,
        directParticipation: 100,
        effectiveAt: caduca,
      },
    );
    const segunda = refundada[1]!.payload;
    if (segunda.type !== 'ConstitutionFounded') throw new Error('escenario mal armado');

    const forjado = await reencadenar(refundada, 1, {
      ...segunda,
      core: NUCLEO.map((c) =>
        c.clauseId === 'poder_no_transferible' ? { ...c, textHash: hash(hex64(0x777)) } : c,
      ),
      text: conClausulaCambiada(TEXTO, 'poder_no_transferible', hex64(0x777)),
    });

    await expect(verifyChain(forjado)).resolves.toBeUndefined();
    expect(() => replayConstitution(forjado)).toThrow(
      expect.objectContaining({ code: 'CORE_SET_ALTERED' }),
    );
  });

  it('el guardián corre en CADA evento, no sólo en los que tocan el texto', async () => {
    // Se pliega un historial legítimo hasta la apertura, se altera el **estado** —lo que haría un
    // fallo de memoria o una proyección manipulada— y se aplica un evento que no toca el texto:
    // registrar una votación. Tiene que lanzar igual.
    const legitimo = await reformaCompleta();
    let estado = initialConstitutionState(CONSTI);
    const votoIndice = legitimo.findIndex((e) => e.payload.type === 'ReformVoteRecorded');
    for (let i = 0; i < votoIndice; i++) estado = applyConstitution(estado, legitimo[i]!);

    const conNucleoTorcido = {
      ...estado,
      core: estado.core.map((c) =>
        c.clauseId === 'publicidad_del_registro' ? { ...c, textHash: hash(hex64(0x888)) } : c,
      ),
    };
    expect(() => applyConstitution(conNucleoTorcido, legitimo[votoIndice]!)).toThrow(
      expect.objectContaining({ code: 'CORE_CLAUSE_ALTERED' }),
    );
    // Y con el núcleo intacto, ese mismo evento entra sin problema.
    expect(() => applyConstitution(estado, legitimo[votoIndice]!)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El límite: el génesis reescrito entero
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('lo que el pliegue NO puede, y lo que lo cubre', () => {
  it('un génesis reescrito de arriba abajo se pliega: el pliegue compara contra el génesis', async () => {
    const legitimo = await fundar();
    const genesis = legitimo[0]!.payload;
    if (genesis.type !== 'ConstitutionFounded') throw new Error('escenario mal armado');

    const forjado = await reencadenar(legitimo, 0, {
      ...genesis,
      core: NUCLEO.map((c) =>
        c.clauseId === 'lista_taxativa' ? { ...c, textHash: hash(hex64(0x666)) } : c,
      ),
      text: conClausulaCambiada(TEXTO, 'lista_taxativa', hex64(0x666)),
    });

    // Coherente consigo mismo ⇒ se pliega. Decirlo es la mitad del trabajo de este proyecto.
    await expect(verifyChain(forjado)).resolves.toBeUndefined();
    expect(() => replayConstitution(forjado)).not.toThrow();
  });

  it('pero el hash del núcleo publicado y anclado lo delata', async () => {
    const legitimo = await fundar();
    const publicado = await constitutionCoreHash(NUCLEO);

    await expect(
      verifyConstitutionLog(legitimo, { expectedCoreHash: publicado }),
    ).resolves.toBeDefined();

    const genesis = legitimo[0]!.payload;
    if (genesis.type !== 'ConstitutionFounded') throw new Error('escenario mal armado');
    const forjado = await reencadenar(legitimo, 0, {
      ...genesis,
      core: NUCLEO.map((c) =>
        c.clauseId === 'lista_taxativa' ? { ...c, textHash: hash(hex64(0x666)) } : c,
      ),
      text: conClausulaCambiada(TEXTO, 'lista_taxativa', hex64(0x666)),
    });

    await expect(
      verifyConstitutionLog(forjado, { expectedCoreHash: publicado }),
    ).rejects.toMatchObject({ code: 'CORE_SET_ALTERED' });
  });

  it('el hash del núcleo es estable y distingue un solo carácter', async () => {
    const a = await constitutionCoreHash(NUCLEO);
    const b = await constitutionCoreHash([...NUCLEO]);
    expect(b).toBe(a);
    const c = await constitutionCoreHash(
      NUCLEO.map((x, i) => (i === 0 ? { ...x, textHash: hash(hex64(0x101)) } : x)),
    );
    expect(c).not.toBe(a);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Las piezas sueltas
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('la proyección del núcleo', () => {
  it('recompone los seis puntos desde el texto, en el orden del §6.b', () => {
    const proyectado = coreProjection(TEXTO, NUCLEO);
    expect(proyectado.map((c) => c.clauseId)).toEqual([...CORE_CLAUSE_IDS]);
    expect(() => {
      assertCoreIntact(NUCLEO, TEXTO);
    }).not.toThrow();
  });

  it('lanza en cuanto uno de los seis cambia, y dice cuál', () => {
    for (const id of CORE_CLAUSE_IDS) {
      const torcido = conClausulaCambiada(TEXTO, id, hex64(0xabc));
      let capturado: unknown;
      try {
        assertCoreIntact(NUCLEO, torcido);
      } catch (error) {
        capturado = error;
      }
      expect(capturado).toBeInstanceOf(CoreAlteredError);
      expect(capturado).toMatchObject({ violation: 'CORE_CLAUSE_ALTERED', clauseId: id });
    }
  });

  it('sin núcleo fijado —antes del génesis— no hay nada que comparar', () => {
    expect(() => {
      assertCoreIntact([], TEXTO);
    }).not.toThrow();
  });
});
