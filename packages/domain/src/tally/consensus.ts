/**
 * **B.10 — Consenso formal.** Nadie bloquea, y no se apartó demasiada gente.
 *
 * ═══ Qué hace distinto a los otros dos ═══
 *
 * `unanimity` exige que todo el mundo esté a favor. `sociocratic-consent` exige que nadie objete
 * con daño argumentado. Éste tiene una figura que ninguno de los dos tiene: **apartarse**.
 *
 * Apartarse es decir «no lo apoyo, no lo voy a impedir, y quiero que conste que no lo apoyo». Sin
 * esa figura, quien tiene una reserva profunda que no llega a daño argumentado tiene que elegir
 * entre fingir acuerdo y bloquear — y las dos salidas son peores que la verdad. Con ella, el
 * desacuerdo queda escrito sin costarle al grupo la parálisis de un bloqueo.
 *
 * ═══ Y por qué eso exige un tope ═══
 *
 * Porque si apartarse no costara nada, sería gratis, y un acuerdo que pasa con la mitad del grupo
 * apartándose está técnicamente desbloqueado y políticamente hueco. `maxStandAside` es el tope. Es
 * lo que convierte la figura en un método y no en un matiz: sin él, «consenso» sería
 * «consentimiento con una etiqueta más».
 *
 * Pasado el tope no se rechaza la idea: se devuelve para reformular. La diferencia importa, porque
 * lo que dice el resultado es «así no, pero no dijimos que no» — y quien lea eso sabe que vale la
 * pena volver a intentarlo, que es exactamente lo contrario de lo que dice un rechazo.
 *
 * ═══ El silencio ═══
 *
 * No cuenta como nada. No apoya, no se aparta, no bloquea. Por eso hay `minEngagement`: sin un piso
 * de participación, un acuerdo firmado por tres de trescientas sería un consenso perfecto sobre el
 * papel. Es la misma cautela de B.3 y por la misma razón.
 */

import type { DecisionConfig } from '../config.js';
import { cmpFraction, ratio } from '../fraction.js';
import type { MemberId } from '../ids.js';
import type { EffectiveBallot, MethodTally } from './common.js';
import { step } from './common.js';

export function tallyConsensus(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
): MethodTally {
  if (config.method.kind !== 'consensus') {
    throw new Error('tallyConsensus exige un método de consenso');
  }
  const { maxStandAside, minEngagement } = config.method;

  /** Vale la última de cada persona, como en todo el motor: cambiar de postura es legítimo. */
  const ultima = new Map<MemberId, EffectiveBallot>();
  for (const papeleta of ballots) {
    const previa = ultima.get(papeleta.voter);
    if (previa === undefined || papeleta.seq > previa.seq) ultima.set(papeleta.voter, papeleta);
  }

  const posturas = [...ultima.values()]
    .filter((p) => p.payload.kind === 'consensus')
    .sort((a, b) => a.seq - b.seq);

  const cuenta = { 'de-acuerdo': 0, 'con-reservas': 0, 'me-aparto': 0, bloqueo: 0 };
  const bloqueos: EffectiveBallot[] = [];
  const apartados: EffectiveBallot[] = [];
  for (const p of posturas) {
    if (p.payload.kind !== 'consensus') continue;
    cuenta[p.payload.stance] += 1;
    if (p.payload.stance === 'bloqueo') bloqueos.push(p);
    if (p.payload.stance === 'me-aparto') apartados.push(p);
  }

  const seManifestaron = posturas.length;
  const censo = Math.max(config.electorate.censusSize, 1);
  const participacion = ratio(seManifestaron, censo);

  const tablas = [
    {
      title: 'Cómo quedó el grupo',
      columns: ['Postura', 'Cuántos'] as const,
      rows: [
        ['De acuerdo', cuenta['de-acuerdo']],
        ['De acuerdo, con reservas', cuenta['con-reservas']],
        ['Se apartaron', cuenta['me-aparto']],
        ['Bloquearon', cuenta.bloqueo],
      ],
    },
  ];

  const pasos = [
    step(
      'CS1',
      `Se manifestaron ${String(seManifestaron)} de ${String(censo)}.`,
      { seManifestaron, censo },
      posturas.map((p) => p.seq),
    ),
  ];

  // ── Piso de participación ───────────────────────────────────────────────────────────────────
  if (cmpFraction(participacion, minEngagement) < 0) {
    return {
      outcome: { kind: 'no-quorum', achieved: participacion, required: minEngagement },
      steps: pasos,
      tables: tablas,
      narrative:
        `Se manifestaron ${String(seManifestaron)} personas de ${String(censo)}, y hacía falta más ` +
        'gente para que un acuerdo del grupo signifique que el grupo acordó algo. No se rechazó: ' +
        'no llegó a haber acuerdo que juzgar.',
    };
  }

  // ── Bloqueos ────────────────────────────────────────────────────────────────────────────────
  if (bloqueos.length > 0) {
    return {
      outcome: { kind: 'rejected', reason: 'objections-pending' },
      steps: [
        ...pasos,
        step(
          'CS2',
          `Hay ${String(bloqueos.length)} bloqueo(s) en pie, cada uno con su motivo escrito.`,
          { bloqueos: bloqueos.length },
          bloqueos.map((p) => p.seq),
        ),
      ],
      tables: tablas,
      narrative:
        `${String(bloqueos.length)} ${bloqueos.length === 1 ? 'persona bloqueó' : 'personas bloquearon'}, ` +
        'y en consenso un bloqueo detiene la propuesta. Bloquear no es votar en contra: es decir que ' +
        'esto no puede seguir así, y por eso hubo que escribir el motivo. Ahí está para responderlo.',
    };
  }

  // ── El tope de quienes se apartan ───────────────────────────────────────────────────────────
  const fraccionApartados = ratio(apartados.length, Math.max(seManifestaron, 1));
  if (cmpFraction(fraccionApartados, maxStandAside) > 0) {
    return {
      outcome: { kind: 'rejected', reason: 'too-many-stand-asides' },
      steps: [
        ...pasos,
        step(
          'CS3',
          `Se apartaron ${String(apartados.length)} de ${String(seManifestaron)}, por encima del tope.`,
          { apartados: apartados.length, deCuantos: seManifestaron },
          apartados.map((p) => p.seq),
        ),
      ],
      tables: tablas,
      narrative:
        `Nadie bloqueó, pero ${String(apartados.length)} de ${String(seManifestaron)} se apartaron: ` +
        'demasiadas para llamar a esto un acuerdo del grupo. No es un rechazo — nadie dijo que no—, ' +
        'es que así no. Los motivos de quienes se apartaron están escritos, y son por dónde ' +
        'reformularlo.',
    };
  }

  return {
    outcome: {
      kind: 'approved',
      ...(config.options[0] === undefined ? {} : { option: config.options[0] }),
    },
    steps: [
      ...pasos,
      step('CS2', 'Nadie bloqueó.', { bloqueos: 0 }, []),
      step(
        'CS3',
        `Se apartaron ${String(apartados.length)} de ${String(seManifestaron)}, dentro del tope.`,
        { apartados: apartados.length, deCuantos: seManifestaron },
        apartados.map((p) => p.seq),
      ),
    ],
    tables: tablas,
    narrative:
      'Hay acuerdo: nadie bloqueó y quienes se apartaron están dentro de lo que el grupo fijó como ' +
      `tolerable (${String(apartados.length)} de ${String(seManifestaron)}). Acuerdo no quiere decir ` +
      'entusiasmo: quiere decir que nadie lo va a impedir y que quienes no lo apoyan quedaron ' +
      'anotados como lo que son.',
  };
}
