/**
 * Detección de manipulación: qué ve el verificador cuando el administrador con `root` actúa (§2.2,
 * §2.3, §5.4).
 *
 * Los tres ataques de este fichero se ejecutan **de verdad**, con el superusuario y desactivando el
 * trigger, porque ésa es exactamente la posición del adversario que el diseño declara. No se
 * pretende impedirlos: se comprueba que **ninguno pasa en silencio** y que el informe dice el
 * agregado, el `leaf_index` y el `seq` exactos.
 *
 *  1. Alterar UN byte del payload         -> `broken-chain` / `event-hash-mismatch` en ese evento.
 *  2. Reordenar las claves del payload    -> `payload-not-canonical`: ya no es la preimagen.
 *  3. Borrar un AGREGADO ENTERO           -> `dangling-genesis-pointer` (la espina lo delata),
 *                                            `gap-in-global-index` (el índice denso lo delata) y
 *                                            `head-without-events`.
 *
 * El ataque 3 es el que la topología «una cadena por agregado» NO ve por sí sola: los 40 eventos se
 * van juntos con la cadena que los unía, ninguna otra cadena se rompe y un verificador ingenuo daría
 * verde. Lo que lo delata es el doble vínculo con la espina.
 */

import {
  append,
  readStream,
  verifyAggregate,
  verifyLedger,
  type PgPool,
  type PgPoolClient,
} from '@koinonia/api';
import { canonicalize, toHex } from '@koinonia/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { id32, iso, ledgerEnv, ready, requestId, skipNote } from './helpers/ledger-env.js';

const env = await ledgerEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

const ALTERADO = id32('manipulacion-alterado');
const BORRADO = id32('manipulacion-borrado');
const TESTIGO = id32('manipulacion-testigo');

/** Ejecuta como el administrador: superusuario y con el trigger append-only apagado. */
async function comoAdministrador<T>(
  pool: PgPool,
  body: (client: PgPoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE governance.event DISABLE TRIGGER trg_event_append_only');
    return await body(client);
  } finally {
    await client
      .query('ALTER TABLE governance.event ENABLE ALWAYS TRIGGER trg_event_append_only')
      .catch(() => undefined);
    client.release();
  }
}

/**
 * El escalón siguiente del atacante: `DISABLE TRIGGER ALL`, que apaga también los triggers internos
 * de integridad referencial y por tanto la clave foránea `event_spine_fk`.
 *
 * Restaurar exige volver a poner `ALWAYS` a mano: `ENABLE TRIGGER ALL` los deja en `ORIGIN`, que es
 * el modo que `session_replication_role = 'replica'` desactiva. Un «lo vuelvo a dejar como estaba»
 * descuidado degrada la defensa sin que nadie lo note; por eso el catálogo se comprueba después.
 */
async function comoAdministradorSinFrenos<T>(
  pool: PgPool,
  body: (client: PgPoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE governance.event DISABLE TRIGGER ALL');
    return await body(client);
  } finally {
    await client.query('ALTER TABLE governance.event ENABLE TRIGGER ALL').catch(() => undefined);
    for (const trigger of ['trg_event_append_only', 'trg_event_no_truncate']) {
      await client
        .query(`ALTER TABLE governance.event ENABLE ALWAYS TRIGGER ${trigger}`)
        .catch(() => undefined);
    }
    client.release();
  }
}

describe.skipIf(!env.ok)(`detección de manipulación${skipNote(env)}`, () => {
  let appPool: PgPool;
  let superPool: PgPool;

  beforeAll(async () => {
    appPool = ready(env).appPool;
    superPool = ready(env).superPool;

    for (const [aggregateId, n] of [
      [ALTERADO, 5],
      [BORRADO, 6],
      [TESTIGO, 3],
    ] as const) {
      await append(appPool, {
        aggregateId,
        aggregateType: 'propuesta',
        expectedHead: { kind: 'new' },
        requestId: requestId(`manipulacion-${aggregateId}`),
        events: Array.from({ length: n }, (_, i) => ({
          eventType: i === 0 ? 'PropuestaAbierta' : 'VotoEmitido',
          occurredAt: iso(i * 1000),
          payload: { indice: i, texto: `argumento numero ${String(i)}` },
        })),
      });
    }
  });

  it('con la historia intacta, el verificador no denuncia nada', async () => {
    const informe = await verifyLedger(appPool);
    expect(informe.findings).toStrictEqual([]);
    expect(informe.ok).toBe(true);
    expect(informe.eventCount).toBe(
      informe.maxLeafIndex === undefined ? 0n : informe.maxLeafIndex + 1n,
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 1. Un byte
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it('alterar UN byte del payload se detecta y se señala el evento EXACTO', async () => {
    const antes = await readStream(appPool, ALTERADO);
    const objetivo = antes[2];
    expect(objetivo).toBeDefined();
    if (objetivo === undefined) return;

    const original = objetivo.payloadText;
    // Se cambia una sola letra dentro de un valor de cadena: sigue siendo JSON canónico válido, de
    // modo que ninguna comprobación estructural lo caza. Sólo el hash lo ve.
    const alterado = original.replace('argumento numero 2', 'argumento numero 3');
    expect(alterado).not.toBe(original);
    expect(alterado).toHaveLength(original.length);

    await comoAdministrador(superPool, async (client) => {
      await client.query('UPDATE governance.event SET payload = $1 WHERE leaf_index = $2::bigint', [
        alterado,
        objetivo.leafIndex.toString(),
      ]);
    });

    const informe = await verifyLedger(appPool);
    expect(informe.ok).toBe(false);

    const hallazgo = informe.findings.find(
      (f) => f.code === 'broken-chain' && f.aggregateId === ALTERADO,
    );
    expect(hallazgo).toBeDefined();
    expect(hallazgo?.detail).toContain('event-hash-mismatch');
    expect(hallazgo?.detail).toContain('fue alterado');
    // El punto exacto: el evento, no «algo en algún sitio».
    expect(hallazgo?.leafIndex).toBe(objetivo.leafIndex);
    expect(hallazgo?.seq).toBe(2);
    expect(hallazgo?.actual).toBe(toHex(objetivo.eventHash));
    expect(hallazgo?.expected).not.toBe(hallazgo?.actual);

    // Y la denuncia es LOCAL: los otros agregados siguen verificando.
    await expect(verifyAggregate(appPool, TESTIGO)).resolves.toMatchObject({ ok: true });
    await expect(verifyAggregate(appPool, BORRADO)).resolves.toMatchObject({ ok: true });

    // Restaurar. Que la alarma desaparezca al restaurar el byte demuestra que el detector es
    // PRECISO y no una alarma pegada: un verificador que se queda en rojo para siempre no sirve.
    await comoAdministrador(superPool, async (client) => {
      await client.query('UPDATE governance.event SET payload = $1 WHERE leaf_index = $2::bigint', [
        original,
        objetivo.leafIndex.toString(),
      ]);
    });
    await expect(verifyLedger(appPool)).resolves.toMatchObject({ ok: true, findings: [] });
  });

  it('reordenar las claves del payload se detecta aunque el JSON siga siendo equivalente', async () => {
    const antes = await readStream(appPool, ALTERADO);
    const objetivo = antes[1];
    expect(objetivo).toBeDefined();
    if (objetivo === undefined) return;

    const original = objetivo.payloadText;
    expect(original).toBe(canonicalize({ indice: 1, texto: 'argumento numero 1' }));
    // Mismo valor lógico, otra secuencia de bytes. Es LO QUE HACE `jsonb` al releer.
    const reordenado = '{"texto":"argumento numero 1","indice":1}';

    await comoAdministrador(superPool, async (client) => {
      await client.query('UPDATE governance.event SET payload = $1 WHERE leaf_index = $2::bigint', [
        reordenado,
        objetivo.leafIndex.toString(),
      ]);
    });

    const informe = await verifyLedger(appPool);
    expect(informe.ok).toBe(false);
    const hallazgo = informe.findings.find((f) => f.code === 'payload-not-canonical');
    expect(hallazgo).toBeDefined();
    expect(hallazgo?.leafIndex).toBe(objetivo.leafIndex);
    expect(hallazgo?.aggregateId).toBe(ALTERADO);

    await comoAdministrador(superPool, async (client) => {
      await client.query('UPDATE governance.event SET payload = $1 WHERE leaf_index = $2::bigint', [
        original,
        objetivo.leafIndex.toString(),
      ]);
    });
    await expect(verifyLedger(appPool)).resolves.toMatchObject({ ok: true });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 2. El agregado entero
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it('BORRAR UN AGREGADO ENTERO se detecta por el puntero colgante de la espina (§2.3)', async () => {
    const antes = await readStream(appPool, BORRADO);
    expect(antes).toHaveLength(6);
    const genesisHash = toHex(antes[0]?.eventHash ?? new Uint8Array());

    // La espina había registrado su nacimiento hacia adelante.
    const espinaAntes = await appPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM governance.event
        WHERE event_type = 'AgregadoAbierto' AND payload_idx->>'aggregateId' = $1`,
      [BORRADO],
    );
    expect(espinaAntes.rows[0]?.n).toBe('1');

    // El ataque: `DELETE FROM event WHERE aggregate_id = '…'`. Los 6 eventos se van JUNTOS, con
    // toda su cadena interna. Ninguna cadena se rompe: la que los unía se fue con ellos.
    const borradas = await comoAdministrador(superPool, async (client) => {
      const r = await client.query('DELETE FROM governance.event WHERE aggregate_id = $1', [
        BORRADO,
      ]);
      return r.rowCount;
    });
    expect(borradas).toBe(6);
    expect(await readStream(appPool, BORRADO)).toStrictEqual([]);

    const informe = await verifyLedger(appPool);
    expect(informe.ok).toBe(false);

    // (a) Capa 1 — estructural: la espina afirma un nacimiento cuyo génesis ya no existe.
    const colgante = informe.findings.find((f) => f.code === 'dangling-genesis-pointer');
    expect(colgante).toBeDefined();
    expect(colgante?.aggregateId).toBe(BORRADO);
    expect(colgante?.expected).toBe(genesisHash);
    expect(colgante?.actual).toBe('ausente');
    expect(colgante?.detail).toContain('borrado o reescrito entero');

    // (b) Capa 2 — aritmética: seis agujeros en una secuencia que se declaró densa.
    const hueco = informe.findings.find((f) => f.code === 'gap-in-global-index');
    expect(hueco).toBeDefined();
    expect(hueco?.detail).toContain('le faltan 6 entradas');
    expect(hueco?.detail).toContain('No es un rollback');

    // (c) Y la caché de cabezas se queda apuntando a una historia que ya no está.
    const cabeza = informe.findings.find(
      (f) => f.code === 'head-without-events' && f.aggregateId === BORRADO,
    );
    expect(cabeza).toBeDefined();

    // Lo que NO pasa, y es el punto entero de §2.2: los demás agregados verifican perfectamente.
    // Sin la espina, el informe habría salido en verde y la propuesta simplemente nunca existió.
    await expect(verifyAggregate(appPool, TESTIGO)).resolves.toMatchObject({ ok: true });
    await expect(verifyAggregate(appPool, ALTERADO)).resolves.toMatchObject({ ok: true });
  });

  it('para tapar el borrado hay que romper también la espina, y eso se ve igual', async () => {
    // El siguiente paso del atacante: quitar de la espina el `AgregadoAbierto` que le delata.
    const espina = await appPool.query<{ leaf_index: string }>(
      `SELECT leaf_index::text AS leaf_index FROM governance.event
        WHERE event_type = 'AgregadoAbierto' AND payload_idx->>'aggregateId' = $1`,
      [BORRADO],
    );
    const leaf = espina.rows[0]?.leaf_index;
    expect(leaf).toBeDefined();
    if (leaf === undefined) return;

    // Primer intento: con el trigger append-only apagado NO basta. La clave foránea `event_spine_fk`
    // lo impide, porque ese evento de la espina es la cabeza de la que cuelga el génesis de un
    // agregado nacido después. Para quitarlo habría que borrar antes a TODOS sus descendientes: el
    // coste del encubrimiento crece en cascada, que es precisamente el efecto buscado.
    await expect(
      comoAdministrador(superPool, async (client) => {
        await client.query('DELETE FROM governance.event WHERE leaf_index = $1::bigint', [leaf]);
      }),
    ).rejects.toMatchObject({ code: '23503', constraint: 'event_spine_fk' });

    // Segundo intento, ya sin ningún freno: `DISABLE TRIGGER ALL` apaga también la integridad
    // referencial. Un superusuario puede. Y aun así, no pasa en silencio.
    await comoAdministradorSinFrenos(superPool, async (client) => {
      await client.query('DELETE FROM governance.event WHERE leaf_index = $1::bigint', [leaf]);
    });

    const informe = await verifyLedger(appPool);
    expect(informe.ok).toBe(false);

    // El puntero colgante desaparece… y a cambio se rompe la cadena LINEAL de la espina, que es una
    // sola para todo el sistema. Tapar el agujero exige reescribirla entera desde ese punto, lo que
    // cambia el `prevHash` génesis de TODOS los agregados nacidos después, en cascada, y contradice
    // cada raíz ya anclada fuera del alcance del administrador.
    expect(informe.findings.some((f) => f.code === 'dangling-genesis-pointer')).toBe(false);
    const espinaRota = informe.findings.find(
      (f) => f.code === 'broken-chain' && f.aggregateId === '00000000000000000000000000000001',
    );
    expect(espinaRota).toBeDefined();
    expect(espinaRota?.detail).toMatch(/seq-mismatch|prev-hash-mismatch/u);

    // Y el índice global sigue gritando: ahora faltan siete.
    const hueco = informe.findings.find((f) => f.code === 'gap-in-global-index');
    expect(hueco?.detail).toContain('le faltan 7 entradas');
  });
});
