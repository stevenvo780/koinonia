/**
 * **B.9 — Proceso de consejo.** Decide una persona, después de escuchar.
 *
 * ═══ Qué se cuenta acá, y qué NO ═══
 *
 * No se cuentan votos. El consejo **no ata**: quien decide puede hacer exactamente lo contrario de
 * lo que le dijeron todos, y eso no es un defecto del método, es el método. Lo único que este
 * escrutinio hace cumplir es la obligación de haber preguntado — que es lo que el proceso de
 * consejo promete y lo único que un programa puede comprobar de él.
 *
 * Por eso el desenlace sale de UNA papeleta, la de quien decide, y el resto de la demostración
 * sirve para otra cosa: dejar por escrito a quién se le preguntó y qué contestó. Ese registro es
 * el que permite discutir después la decisión sin discutir si hubo consulta.
 *
 * ═══ Los dos motivos por los que puede no salir nada ═══
 *
 * 1. **No se aconsejó lo suficiente.** Menos de `minAdvisors` personas distintas. Sale `no-quorum`,
 *    que es literalmente lo que pasó: no participó bastante gente para que la decisión valga.
 * 2. **Nadie decidió.** El plazo se venció y quien tenía que decidir no lo hizo. Sale `rejected`
 *    con motivo `no-decision`, y no con `threshold-not-met`: acá no hay ningún umbral que quedara
 *    corto. La consecuencia práctica es la misma —no se adoptó nada— pero el porqué es otro, y una
 *    pantalla que los confunda le dice a la gente que arregle lo que no está roto.
 *
 * ═══ Por qué los pesos no se miran ═══
 *
 * `EffectiveBallot.weight` existe para el voto prestado. Acá se ignora a propósito: un consejo vale
 * por haber sido dado, no por cuánta gente representa quien lo da, y el proceso de consejo no
 * admite delegación (ver `metodos.ts`, junto a `admiteDelegacion`). Contar «Marta aconsejó por
 * siete» convertiría el consejo en un voto ponderado, que es exactamente lo que este método
 * rechaza ser.
 */

import type { DecisionConfig } from '../config.js';
import { ratio } from '../fraction.js';
import type { MemberId } from '../ids.js';
import type { EffectiveBallot, MethodTally } from './common.js';
import { step } from './common.js';

export function tallyAdviceProcess(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
): MethodTally {
  if (config.method.kind !== 'advice-process') {
    throw new Error('tallyAdviceProcess exige un método de proceso de consejo');
  }
  const { decider, minAdvisors } = config.method;

  /*
   * La última papeleta de cada persona, por `seq`. Es la regla de todo el motor —vale la última— y
   * acá importa el doble: quien decide puede cambiar de parecer después de leer un consejo, y ése
   * es justamente el comportamiento que el método quiere fomentar.
   */
  const ultima = new Map<MemberId, EffectiveBallot>();
  for (const papeleta of ballots) {
    const previa = ultima.get(papeleta.voter);
    if (previa === undefined || papeleta.seq > previa.seq) ultima.set(papeleta.voter, papeleta);
  }

  const consejos = [...ultima.values()]
    .filter((p) => p.payload.kind === 'advice')
    .sort((a, b) => a.seq - b.seq);
  const decision = ultima.get(decider);
  const decidio = decision?.payload.kind === 'binary' ? decision.payload : undefined;

  const filas = consejos.map((p) => [
    p.voter,
    p.payload.kind === 'advice' ? p.payload.stance : '',
    // El texto del consejo NO sale en la tabla: puede ser largo y esto es un índice, no un volcado.
    // Quien quiera leerlos los tiene en la pantalla de la decisión, que es donde se leen.
    p.payload.kind === 'advice' ? String(p.payload.reasoning.trim().length) : 0,
  ]);

  const tablas = [
    {
      title: 'Quién aconsejó',
      columns: ['Miembro', 'Qué dijo', 'Caracteres'] as const,
      rows: filas,
    },
  ];

  const pasos = [
    step(
      'AC1',
      `Aconsejaron ${String(consejos.length)} personas distintas; hacían falta ${String(minAdvisors)}.`,
      { aconsejaron: consejos.length, hacianFalta: minAdvisors },
      consejos.map((p) => p.seq),
    ),
  ];

  if (consejos.length < minAdvisors) {
    return {
      outcome: {
        kind: 'no-quorum',
        achieved: ratio(consejos.length, Math.max(config.electorate.censusSize, 1)),
        required: ratio(minAdvisors, Math.max(config.electorate.censusSize, 1)),
      },
      steps: pasos,
      tables: tablas,
      narrative:
        'Acá no se vota: decide una persona, y sólo después de escuchar. Le aconsejaron ' +
        `${String(consejos.length)} personas y hacían falta ${String(minAdvisors)}, así que la ` +
        'decisión todavía no puede tomarse. No es que se haya rechazado: es que falta escuchar.',
    };
  }

  if (decidio === undefined) {
    return {
      outcome: { kind: 'rejected', reason: 'no-decision' },
      steps: [
        ...pasos,
        step('AC2', 'Se venció el plazo y quien tenía que decidir no decidió.', { decidio: 'no' }),
      ],
      tables: tablas,
      narrative:
        `Hubo consejo suficiente —${String(consejos.length)} personas— pero quien tenía que decidir ` +
        'no lo hizo antes de que se venciera el plazo, así que no se adoptó nada. No se rechazó la ' +
        'propuesta: nadie la resolvió.',
    };
  }

  return {
    outcome: decidio.approve
      ? {
          kind: 'approved',
          ...(config.options[0] === undefined ? {} : { option: config.options[0] }),
        }
      : { kind: 'rejected', reason: 'decided-against' },
    steps: [
      ...pasos,
      step(
        'AC2',
        decidio.approve
          ? 'Quien decide resolvió que sí, después de escuchar.'
          : 'Quien decide resolvió que no, después de escuchar.',
        { decidio: decidio.approve ? 'sí' : 'no' },
        decision === undefined ? [] : [decision.seq],
      ),
    ],
    tables: tablas,
    narrative:
      'Acá no se vota: decide una persona, y sólo después de escuchar. Escuchó a ' +
      `${String(consejos.length)} —hacían falta ${String(minAdvisors)}— y resolvió que ` +
      `${decidio.approve ? 'sí' : 'no'}. El consejo no ata: puede haber decidido en contra de lo ` +
      'que le dijeron, y eso está permitido. Lo que no estaba permitido era no preguntar.',
  };
}
