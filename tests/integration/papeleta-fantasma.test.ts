/**
 * La red de seguridad de `persistDecisionLog`: no decir «escrito» sobre algo que no se escribió.
 *
 * `emitirPapeleta` ya no puede caer en esta trampa —desde el 2026-08-25 lee y escribe bajo el mismo
 * cerrojo (`escribirSobreDecision`)—, pero `persistDecisionLog` es pública, la usan otras rutas y la
 * usará quien escriba la siguiente. La rama que devolvía éxito sin escribir sigue estando en el
 * camino de todas ellas, así que se protege donde vive.
 *
 * ═══ La trampa, en una frase ═══
 *
 * «No queda nada pendiente» tiene dos causas. Una es buena: este log ya está escrito y alguien lo
 * vuelve a guardar. La otra es la peor de todas: el ledger avanzó EXACTAMENTE lo mismo que mide este
 * log porque el evento de OTRA persona ocupó ese número de posición. La cuenta cuadra y el contenido
 * no. Hasta el 2026-08-25 no se distinguían, y la segunda devolvía éxito —de ahí las 174
 * confirmaciones falsas de `docs/TESTING.md` §11.2.
 *
 * Comprobado rompiéndolo: devolviendo `cabezaAjena = false` a secas en `persistDecisionLog`, el
 * segundo caso deja de lanzar y pasa a devolver `appended: 0` como si hubiera escrito. Restaurado.
 */

import { loadDecisionLog, persistDecisionLog, readStream, type PgPool } from '@koinonia/api';
import { castBallot, instant, type DecisionLog } from '@koinonia/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ballotIdAt,
  eventIdAt,
  memberIdAt,
  voteToPayload,
} from '../../packages/domain/test/arbitraries.js';

import { buildFullDecision, DECISION_ID, PROPOSAL_V1, T0 } from './helpers/decision-fixture.js';
import { ledgerEnv, ready, requestId, skipNote } from './helpers/ledger-env.js';

const env = await ledgerEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

describe.skipIf(!env.ok)(
  `una papeleta que no se escribió no se declara escrita${skipNote(env)}`,
  () => {
    let pool: PgPool;
    /** El log hasta antes de la última papeleta: la base sobre la que dos personas van a competir. */
    let base: DecisionLog;

    beforeAll(async () => {
      pool = ready(env).appPool;
      const completo = await buildFullDecision(['yes', 'yes', 'no']);
      // Se corta antes de las papeletas: quedan el borrador y la apertura, que es el punto exacto
      // donde dos personas que votan a la vez leen lo mismo.
      base = completo.log.slice(0, 2);
      await persistDecisionLog(pool, base, { requestId: requestId('fantasma-base') });
    });

    /** La papeleta de una persona, construida contra la MISMA base que la de la otra. */
    async function papeletaDe(indice: number): Promise<DecisionLog> {
      return await castBallot(base, {
        eventId: eventIdAt(900 + indice),
        at: instant(T0 + 1000 + indice),
        actor: memberIdAt(indice),
        ballot: {
          ballotId: ballotIdAt(900 + indice),
          decisionId: DECISION_ID,
          voter: memberIdAt(indice),
          round: 1,
          payload: voteToPayload('yes', indice, 1),
          proposalVersionHash: PROPOSAL_V1,
        },
      });
    }

    it('la primera papeleta se escribe', async () => {
      const primera = await persistDecisionLog(pool, await papeletaDe(0), {
        requestId: requestId('fantasma-primera'),
      });
      expect(primera.appended).toBe(1);
      expect(await readStream(pool, DECISION_ID)).toHaveLength(3);
    });

    it('la segunda, construida contra la misma base, se RECHAZA en vez de fingir que entró', async () => {
      // Mide lo mismo que la primera —tres eventos— así que la vieja rama de «nada pendiente» la
      // daba por escrita. Su contenido es otro: es el voto de otra persona.
      const segunda = await papeletaDe(1);
      await expect(
        persistDecisionLog(pool, segunda, { requestId: requestId('fantasma-segunda') }),
      ).rejects.toThrow(/conflicto de cabeza/iu);
      // Y sobre todo: no escribió nada ni pisó lo de nadie.
      expect(await readStream(pool, DECISION_ID)).toHaveLength(3);
    });

    it('el voto que sí entró es el que quedó, y el log se relee entero', async () => {
      const releido = await loadDecisionLog(pool, DECISION_ID);
      expect(releido).toHaveLength(3);
      const ultimo = releido[2];
      expect(ultimo?.payload.type).toBe('BallotCast');
      expect(ultimo?.eventId).toBe(eventIdAt(900));
    });

    it('volver a guardar el MISMO log sigue siendo una operación válida y no escribe nada', async () => {
      // La otra causa de «nada pendiente», la buena. Si el arreglo la hubiera roto, cualquier
      // reintento honesto del llamante pasaría a ser un error.
      const otra = await persistDecisionLog(pool, await loadDecisionLog(pool, DECISION_ID), {
        requestId: requestId('fantasma-mismo'),
      });
      expect(otra.appended).toBe(0);
      expect(await readStream(pool, DECISION_ID)).toHaveLength(3);
    });
  },
);
