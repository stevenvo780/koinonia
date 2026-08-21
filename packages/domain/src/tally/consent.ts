/**
 * B.3 — Consentimiento sociocrático («¿alguien objeta?»).
 *
 * **No se cuentan votos a favor.** La propuesta pasa si, al cerrar la ronda, no existe ninguna
 * objeción admitida y no integrada:
 *
 * ```
 *   Pasa(ronda r) ⟺ |{ o : admitida(o) ∧ ¬integrada(o) }| = 0  ∧  engagement ≥ minEngagement
 * ```
 *
 * ═══ DECISIÓN B.3.a — presunción de validez de la objeción ═══
 *
 * Toda objeción nace **admitida**. Sólo puede desestimarla un panel de personas sorteadas del propio
 * círculo, por 2/3 y con motivación escrita publicada; si el panel no se pronuncia dentro del plazo,
 * la objeción **queda admitida**. La alternativa —que el facilitador califique— concentra en una sola
 * persona el poder de anular disensos, que es exactamente el poder que la sociocracia dice
 * distribuir; en un instituto de filosofía, donde el prestigio académico es asimétrico, sería
 * capturado en un semestre. La carga de la prueba recae en quien quiere silenciar, no en quien
 * disiente.
 *
 * ═══ DECISIÓN B.3.b — «integrar» tiene definición operativa estricta ═══
 *
 * Una objeción sólo queda integrada si existe un evento `ObjectionIntegrated` con un
 * `newProposalVersionHash` distinto **firmado por quien objetó**. Sin la firma no hay integración:
 * hay *modificación unilateral*, que no extingue la objeción. Sin este requisito, «integrar»
 * degenera en «cambiarle una coma y declarar resuelto», el abuso documentado más frecuente en las
 * implementaciones de sociocracia.
 *
 * ═══ DECISIÓN B.3.e — el silencio no consiente ═══
 *
 * `silenceMeans` por defecto es `'not-participating'`, y por eso existe `minEngagement`. «Quien calla
 * otorga» convierte la apatía en aprobación y permite pasar decisiones con dos personas despiertas
 * de treinta.
 *
 * ═══ DECISIÓN B.3.c — las rondas terminan ═══
 *
 * `maxRounds` por defecto 3, tope duro 5. La deliberación sin límite no converge por virtud,
 * converge por agotamiento, y el agotamiento favorece sistemáticamente a quien tiene más tiempo
 * libre — que en una facultad no es una distribución neutral (INV-54).
 */

import type { DecisionConfig } from '../config.js';
import { type Electorate, memberAt } from '../electorate.js';
import { InvalidBallotForMethod } from '../errors.js';
import { cmpFraction, ratio, toFractionString, toPercentString } from '../fraction.js';
import { compareIds, type MemberId, type ObjectionId } from '../ids.js';
import { type EffectiveBallot, type MethodTally, type ProofTable, step } from './common.js';

/** Estado de una objeción, proyectado del log de eventos. */
export type ObjectionStatus = 'admitted' | 'dismissed' | 'withdrawn';

export interface ObjectionRecord {
  readonly objectionId: ObjectionId;
  readonly by: MemberId;
  readonly raisedAtRound: number;
  readonly status: ObjectionStatus;
  /** `true` sólo si hubo `ObjectionIntegrated` firmado por quien objetó (B.3.b). */
  readonly integrated: boolean;
  /** `seq` del evento que fijó el estado actual. Para la traza. */
  readonly seq: number;
}

export interface ConsentContext {
  readonly round: number;
  readonly objections: readonly ObjectionRecord[];
}

/** Objeciones que bloquean: admitidas y no integradas. Es la única condición de paso. */
export function blockingObjections(
  objections: readonly ObjectionRecord[],
): readonly ObjectionRecord[] {
  return objections
    .filter((o) => o.status === 'admitted' && !o.integrated)
    .slice()
    .sort((a, b) => compareIds(a.objectionId, b.objectionId));
}

/**
 * Une las objeciones proyectadas del log con las que viajan **dentro de una papeleta** de postura
 * `object`.
 *
 * DECISIÓN: sin esta unión habría un agujero grave. Una papeleta puede llevar su `Objection`
 * adjunta (A.4) y el ciclo de B.3 la registra además con `ObjectionRaised`; si el escrutinio sólo
 * mirara los eventos de objeción, un log al que le faltara ese registro —por un fallo, o por
 * omisión deliberada de quien lo escribe— produciría «nadie objetó» con papeletas que objetan a la
 * vista. Se resuelve por donde manda B.3.a: **toda objeción nace admitida**, así que una objeción
 * presente en una papeleta efectiva y ausente del registro cuenta como admitida y bloquea. Para
 * dejar de bloquear hay que desestimarla, integrarla o retirarla, y las tres cosas son actos
 * públicos con evento propio.
 */
export function mergeObjections(
  fromLog: readonly ObjectionRecord[],
  ballots: readonly EffectiveBallot[],
): readonly ObjectionRecord[] {
  const merged = [...fromLog];
  for (const ballot of ballots) {
    if (ballot.payload.kind !== 'consent') continue;
    const objection = ballot.payload.objection;
    if (ballot.payload.stance !== 'object' || objection === undefined) continue;
    if (merged.some((o) => o.objectionId === objection.objectionId)) continue;
    merged.push({
      objectionId: objection.objectionId,
      by: ballot.voter,
      raisedAtRound: objection.raisedAtRound,
      status: 'admitted',
      integrated: false,
      seq: ballot.seq,
    });
  }
  return merged.sort((a, b) => compareIds(a.objectionId, b.objectionId));
}

/**
 * `engagement = peso del círculo que se manifestó / |círculo|`.
 *
 * El numerador se atribuye al miembro **representado**, no al autor de la papeleta (D.1.d): si
 * alguien de *Estética* delega en alguien de *Lógica* y este vota, quien se manifestó en *Estética*
 * es el primero. Mientras la PARTE C no exista, `onBehalfOf` está vacío y la cuenta coincide con «un
 * miembro del círculo, una papeleta».
 */
export function consentEngagement(
  electorate: Electorate,
  circleId: DecisionConfig['circleId'],
  ballots: readonly EffectiveBallot[],
): { readonly manifested: number; readonly circleSize: number } {
  const inCircle = (member: MemberId): boolean =>
    memberAt(electorate, member)?.circles.includes(circleId) ?? false;

  let manifested = 0;
  for (const ballot of ballots) {
    if (ballot.payload.kind !== 'consent') continue;
    for (const member of [ballot.voter, ...ballot.onBehalfOf]) {
      if (inCircle(member)) manifested++;
    }
  }
  const circleSize = electorate.members.filter((m) => m.circles.includes(circleId)).length;
  return { manifested, circleSize };
}

export function tallyConsent(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
  context: ConsentContext,
): MethodTally {
  const method = config.method;
  if (method.kind !== 'sociocratic-consent') {
    throw new InvalidBallotForMethod('sociocratic-consent', method.kind);
  }

  let consent = 0;
  let concern = 0;
  let object = 0;
  for (const ballot of ballots) {
    if (ballot.payload.kind !== 'consent') {
      throw new InvalidBallotForMethod(ballot.payload.kind, method.kind);
    }
    switch (ballot.payload.stance) {
      case 'consent':
        consent += ballot.weight;
        break;
      case 'concern':
        concern += ballot.weight;
        break;
      case 'object':
        object += ballot.weight;
        break;
    }
  }

  const { manifested, circleSize } = consentEngagement(config.electorate, config.circleId, ballots);
  const engagement = circleSize === 0 ? ratio(0, 1) : ratio(manifested, circleSize);
  const engagementMet = circleSize > 0 && cmpFraction(engagement, method.minEngagement) >= 0;

  const objections = mergeObjections(context.objections, ballots);
  const blocking = blockingObjections(objections);
  const lastRound = context.round >= method.maxRounds;
  const seqs = ballots.map((b) => b.seq).sort((a, b) => a - b);

  const outcome: MethodTally['outcome'] = ((): MethodTally['outcome'] => {
    if (blocking.length > 0) {
      // B.3.c: agotadas las rondas, la propuesta vuelve al círculo. No hay escalamiento automático
      // (B.3.d): si lo hubiera, objetar sería inútil y el consentimiento, decorativo.
      return lastRound
        ? { kind: 'rejected', reason: 'objections-pending' }
        : { kind: 'needs-new-round', nextRound: context.round + 1 };
    }
    if (!engagementMet) {
      // DECISIÓN: B.3 define cuándo se aprueba pero no qué ocurre si no hay objeciones y el
      // `engagement` es insuficiente. Se falla cerrado: sin manifestación mínima del círculo no hay
      // consentimiento, y la propuesta se rechaza. Abrir una ronda nueva sería inventar una regla
      // (nada se ha enmendado, así que la ronda siguiente sería idéntica); y la falta de gente ya
      // tiene su tratamiento propio y explícito en el quórum de participación y sus prórrogas (D.2).
      // Reportado como hueco de la especificación.
      return { kind: 'rejected', reason: 'threshold-not-met' };
    }
    return {
      kind: 'approved',
      ...(config.options[0] === undefined ? {} : { option: config.options[0] }),
    };
  })();

  const objectionTable: ProofTable = {
    title: 'Objeciones',
    columns: ['Objeción', 'Ronda', 'Estado', '¿Integrada?'],
    rows: objections
      .slice()
      .sort((a, b) => compareIds(a.objectionId, b.objectionId))
      .map((o) => [
        o.objectionId,
        o.raisedAtRound,
        o.status === 'admitted'
          ? 'admitida'
          : o.status === 'dismissed'
            ? 'desestimada'
            : 'retirada',
        o.integrated ? 'sí' : 'no',
      ]),
  };

  const steps = [
    step(
      'S1',
      `Ronda ${String(context.round)} de ${String(method.maxRounds)}. Se manifestaron ` +
        `${String(manifested)} de ${String(circleSize)} miembros del círculo.`,
      {
        ronda: context.round,
        maxRondas: method.maxRounds,
        manifestados: manifested,
        circulo: circleSize,
      },
      seqs,
    ),
    step(
      'S2',
      `Consienten: ${String(consent)}. Con reservas: ${String(concern)}. Objetan: ${String(object)}. ` +
        'Aquí no se cuentan votos a favor: lo único que impide pasar es una objeción admitida.',
      { consienten: consent, conReservas: concern, objetan: object },
      seqs,
    ),
    step(
      'S3',
      `La manifestación fue ${toPercentString(engagement)} del círculo y se exigía al menos ` +
        `${toFractionString(method.minEngagement)}. El silencio ` +
        (method.silenceMeans === 'consent' ? 'se cuenta como consentimiento.' : 'no consiente.'),
      {
        manifestacion: `${String(manifested)}/${String(circleSize)}`,
        exigido: toFractionString(method.minEngagement),
        elSilencio: method.silenceMeans,
        cumple: engagementMet ? 'sí' : 'no',
      },
    ),
    step(
      'S4',
      blocking.length === 0
        ? 'No queda ninguna objeción admitida sin integrar.'
        : `Quedan ${String(blocking.length)} objeciones admitidas sin integrar: ` +
            `${blocking.map((o) => o.objectionId).join(', ')}.`,
      { objecionesBloqueantes: blocking.length },
      blocking.map((o) => o.seq),
    ),
    step(
      'S5',
      outcome.kind === 'approved'
        ? 'Nadie objeta y el círculo se manifestó lo suficiente: la propuesta pasa.'
        : outcome.kind === 'needs-new-round'
          ? `Hay objeciones pendientes: se abre la ronda ${String(outcome.nextRound)} para enmendar.`
          : blocking.length > 0
            ? 'Se agotaron las rondas con objeciones pendientes: la propuesta vuelve al círculo.'
            : 'El círculo no se manifestó lo suficiente: no hay consentimiento.',
      { desenlace: outcome.kind },
    ),
  ];

  return {
    outcome,
    steps,
    tables: [
      {
        title: 'Posturas',
        columns: ['Postura', 'Peso'],
        rows: [
          ['Consiente', consent],
          ['Con reservas', concern],
          ['Objeta', object],
        ],
      },
      objectionTable,
    ],
    narrative:
      'En este método no se cuentan votos a favor: la propuesta pasa si nadie objeta con argumento ' +
      'de daño al fin común y si el círculo se manifestó lo suficiente. ' +
      (outcome.kind === 'approved'
        ? 'Ninguna objeción quedó en pie, así que la propuesta pasa.'
        : outcome.kind === 'needs-new-round'
          ? `Quedaron ${String(blocking.length)} objeciones en pie, así que se abre una ronda nueva para enmendar el texto.`
          : blocking.length > 0
            ? 'Se agotaron las rondas previstas con objeciones todavía en pie, así que la propuesta vuelve al círculo.'
            : 'El círculo no se manifestó lo suficiente, así que no hay consentimiento que declarar.'),
  };
}
