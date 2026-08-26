import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PgPool } from '@koinonia/api';

import { checkpointsPendientes } from '../../services/api/src/anchor/index.js';

import { ledgerEnv, ready, skipNote } from './helpers/ledger-env.js';

/**
 * A qué checkpoint le toca el siguiente intento de anclaje.
 *
 * ═══ Qué se rompía ═══
 *
 * La consulta pedía «los que no están firmes, del más reciente hacia atrás, los primeros N». Dos
 * problemas encadenados, los dos medidos en producción el 2026-08-26:
 *
 *  · **`firm` no lo pone nadie nunca** —34 checkpoints, los 34 en `false`—, así que ese filtro no
 *    filtraba nada y la lista de «pendientes» crecía con la historia.
 *  · **Del más reciente hacia atrás**: con la lista creciendo y el límite fijo, la ventana se aleja
 *    del principio de la historia y los checkpoints más viejos dejan de mirarse **para siempre**. Es
 *    al revés de lo que conviene abandonar: un checkpoint nuevo sin confirmar tiene otra vuelta
 *    dentro de una hora; uno viejo sin confirmar no la tiene nunca.
 *
 * Se vio de la peor manera. Tras arreglar el verificador de anclajes, 29 checkpoints pasaron a
 * confirmados y quedaron tres —los números 1, 6 y 11, los más antiguos— fuera de la ventana, con
 * recibos buenos que nadie iba a volver a mirar.
 *
 * ═══ Por qué esta prueba inserta filas en vez de emitir checkpoints ═══
 *
 * Porque lo que se prueba es **a quién elige la consulta y en qué orden**, y emitir tres
 * checkpoints de verdad exige tres tandas de hechos en el historial: se estaría montando un
 * escenario caro para ejercitar un `ORDER BY`. Las filas se escriben con la misma forma que las
 * reales —`issued_at` con su formato exacto, huella de 32 bytes— y `governance.checkpoint` no está
 * bajo el guardián de sólo-añadir, así que insertarlas no rodea ninguna garantía.
 *
 * Comprobado rompiéndolo: con la consulta vieja (`WHERE firm = false ORDER BY tree_size DESC`)
 * fallan los tres casos — el confirmado vuelve a colarse y el más viejo queda fuera. Restaurada.
 */

const env = await ledgerEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

/** Los tres casos que importan, con números altos para no chocar con nada que ya exista. */
const CONFIRMADO = 900_001;
const NUNCA_INTENTADO = 900_002;
const INTENTADO_HACE_RATO = 900_003;

describe.skipIf(!env.ok)(`la cola de checkpoints por anclar${skipNote(env)}`, () => {
  let pool: PgPool;

  beforeAll(async () => {
    pool = ready(env).appPool;
    const cliente = await pool.connect();
    try {
      for (const [i, size] of [CONFIRMADO, NUNCA_INTENTADO, INTENTADO_HACE_RATO].entries()) {
        await cliente.query(
          `INSERT INTO governance.checkpoint
             (tree_size, root_hash, heads_root, prev_checkpoint, issued_at, checkpoint_hash, firm)
           VALUES ($1, $2, $2, NULL, $3, $4, false)
           ON CONFLICT (tree_size) DO NOTHING`,
          [
            size,
            Buffer.alloc(32, 0x11 + i),
            `2026-08-2${String(i + 1)}T03:00:00.000Z`,
            Buffer.alloc(32, 0x71 + i),
          ],
        );
      }
      // Uno confirmado: no tiene que volver a entrar en la cola.
      await cliente.query(
        `INSERT INTO governance.anchor_attempt
           (tree_size, provider, independence_class, state, receipt, updated_at)
         VALUES ($1, 'ots', 'blockchain', 'CONFIRMADO', '{}', now())
         ON CONFLICT (tree_size, provider) DO UPDATE SET state = 'CONFIRMADO'`,
        [CONFIRMADO],
      );
      // Uno intentado hace rato y fallido: tiene que ir DESPUÉS del que no se intentó nunca.
      await cliente.query(
        `INSERT INTO governance.anchor_attempt
           (tree_size, provider, independence_class, state, updated_at)
         VALUES ($1, 'ots', 'blockchain', 'FALLIDO', now() - interval '2 hours')
         ON CONFLICT (tree_size, provider) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
        [INTENTADO_HACE_RATO],
      );
    } finally {
      cliente.release();
    }
  });

  it('no vuelve a mirar lo que ya tiene un anclaje confirmado', async () => {
    const tamanos = (await checkpointsPendientes(pool, 100)).map((c) => Number(c.treeSize));
    expect(tamanos).not.toContain(CONFIRMADO);
    // Y los otros dos sí están: si la consulta no devolviera nada, lo de arriba pasaría igual.
    expect(tamanos).toContain(NUNCA_INTENTADO);
    expect(tamanos).toContain(INTENTADO_HACE_RATO);
  });

  it('atiende antes al que no se intentó nunca que al intentado hace dos horas', async () => {
    const tamanos = (await checkpointsPendientes(pool, 100)).map((c) => Number(c.treeSize));
    expect(tamanos.indexOf(NUNCA_INTENTADO)).toBeLessThan(tamanos.indexOf(INTENTADO_HACE_RATO));
  });

  it('con el cupo justo entra el más desatendido, no el de número más alto', async () => {
    // El caso exacto que dejó a los checkpoints 1, 6 y 11 abandonados: con un límite pequeño, la
    // regla vieja se llevaba los de número más alto y el desatendido no volvía a entrar nunca.
    const unoSolo = await checkpointsPendientes(pool, 1);
    expect(unoSolo.map((c) => Number(c.treeSize))).toEqual([NUNCA_INTENTADO]);
  });
});
