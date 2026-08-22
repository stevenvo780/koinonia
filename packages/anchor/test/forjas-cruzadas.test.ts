/**
 * **La comprobación cruzada entre las dos forjas.** Es el corazón de la clase de independencia `vcs`.
 *
 * Empujar el commit firmado a dos forjas no protege de nada por sí solo. Lo que protege es
 * **comparar lo que devuelven las dos**: si una fue reescrita con `push --force` y la otra no, las
 * respuestas dejan de coincidir, y ahí es donde se ve. Un anclaje que aprueba porque le preguntó a
 * una sola forja —o porque preguntó a las dos y no comparó— es peor que no tener anclaje: produce un
 * verde que nadie se ganó, y ese verde es exactamente lo que el administrador con `root` necesita.
 *
 * Estas pruebas no salen a la red. Las forjas son dobles deterministas que devuelven bytes; los
 * commits que devuelven están firmados de verdad, con claves Ed25519 de verdad.
 */

import {
  ANCHOR_CONFIRMED,
  ANCHOR_FAILED,
  checkpointBindingLine,
  checkpointRefFromHex,
  commitOid,
  crossCheckForges,
  ForgeDivergenceError,
  runAnchorCycle,
  SignedGitProvider,
  type AnchorReceipt,
  type GitForgeClient,
} from '@koinonia/anchor';
import { toHex } from '@koinonia/crypto';
import { describe, expect, it } from 'vitest';

import {
  commitFirmado,
  type Firmante,
  nuevoFirmante,
  relojFijo,
  T_AHORA,
  T_EMISION,
} from './testigos.js';

const CHECKPOINT = new Uint8Array(32).fill(0x7e);
const HEX = toHex(CHECKPOINT);
const OTRO_HEX = toHex(new Uint8Array(32).fill(0x3a));

function mensajeDe(hex: string, titulo = 'Checkpoint 12480'): string {
  return [titulo, '', checkpointBindingLine(hex), ''].join('\n');
}

/** Forja de mentira: sirve lo que se le ponga, y sólo eso. */
function forja(
  name: string,
  objetos: ReadonlyMap<string, Uint8Array>,
  head?: string,
): GitForgeClient {
  return {
    name,
    fetchCommit: (oid) => Promise.resolve(objetos.get(oid)),
    head: () => Promise.resolve(head),
  };
}

async function forjaCon(name: string, bytes: Uint8Array): Promise<GitForgeClient> {
  const oid = await commitOid(bytes);
  return forja(name, new Map([[oid, bytes]]), oid);
}

function forjaVacia(name: string): GitForgeClient {
  return forja(name, new Map());
}

function forjaRota(name: string): GitForgeClient {
  return {
    name,
    fetchCommit: () => Promise.reject(new Error('502 Bad Gateway')),
    head: () => Promise.reject(new Error('502 Bad Gateway')),
  };
}

function proveedor(
  firmante: Firmante,
  forgeClients: readonly GitForgeClient[],
  minForges = 2,
): SignedGitProvider {
  return new SignedGitProvider({
    allowedSigners: [{ identity: 'Veeduría 2026-2 — M. Restrepo', publicKey: firmante.publicKey }],
    signingKeyOffHost: true,
    forges: ['codeberg', 'github'],
    minForges,
    clock: relojFijo(T_AHORA),
    forgeClients,
  });
}

function solicitud(): AnchorReceipt {
  return {
    provider: 'git',
    independenceClass: 'vcs',
    checkpointHash: HEX,
    externalRef: `solicitud:${HEX.slice(0, 32)}`,
    submittedAt: T_EMISION,
    raw: { requestKind: 'firma_pendiente_de_veeduria' },
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La comparación, aislada
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('crossCheckForges', () => {
  it('sin respuestas no inventa un acuerdo', async () => {
    expect(await crossCheckForges([])).toStrictEqual({ kind: 'sin_respuesta' });
  });

  it('dos forjas con el MISMO objeto son un acuerdo, y el OID se recalcula', async () => {
    const firmante = await nuevoFirmante();
    const bytes = await commitFirmado(firmante, mensajeDe(HEX));

    const cruce = await crossCheckForges([
      { forge: 'codeberg', bytes },
      { forge: 'github', bytes },
    ]);

    expect(cruce.kind).toBe('acuerdo');
    if (cruce.kind !== 'acuerdo') return;
    expect(cruce.forges).toStrictEqual(['codeberg', 'github']);
    expect(cruce.oid).toBe(await commitOid(bytes));
  });

  it('dos forjas con objetos DISTINTOS son una discrepancia, y lo dice con esas palabras', async () => {
    const firmante = await nuevoFirmante();
    const uno = await commitFirmado(firmante, mensajeDe(HEX, 'Checkpoint 12480'));
    const otro = await commitFirmado(firmante, mensajeDe(HEX, 'Checkpoint 12480 (rehecho)'));

    const cruce = await crossCheckForges([
      { forge: 'codeberg', bytes: uno },
      { forge: 'github', bytes: otro },
    ]);

    expect(cruce.kind).toBe('discrepancia');
    if (cruce.kind !== 'discrepancia') return;
    expect(cruce.reason).toBe('objetos-distintos');
    expect(cruce.variants).toHaveLength(2);
    expect(cruce.variants.map((v) => v.forges)).toStrictEqual([['codeberg'], ['github']]);
    expect(cruce.detail).toMatch(/push --force/u);
  });

  it('bytes distintos bajo el MISMO identificador se tratan como ataque, no como empate', async () => {
    // Git identifica objetos con SHA-1 y SHA-1 tiene colisiones de prefijo elegido desde 2019.
    // Fabricar una aquí costaría decenas de miles de dólares, así que se inyecta un resumen que
    // colisiona a propósito: lo que se comprueba es que el código MIRA LOS BYTES y no se conforma
    // con que los identificadores coincidan.
    const firmante = await nuevoFirmante();
    const uno = await commitFirmado(firmante, mensajeDe(HEX, 'A'));
    const otro = await commitFirmado(firmante, mensajeDe(HEX, 'B'));
    const colisionador = (): Promise<string> => Promise.resolve('c'.repeat(40));

    const cruce = await crossCheckForges(
      [
        { forge: 'codeberg', bytes: uno },
        { forge: 'github', bytes: otro },
      ],
      colisionador,
    );

    expect(cruce.kind).toBe('discrepancia');
    if (cruce.kind !== 'discrepancia') return;
    expect(cruce.reason).toBe('colision-de-identificador');
    expect(cruce.detail).toMatch(/colisión/u);
    expect(cruce.detail).toMatch(/ataque en curso/u);
  });

  it('la misma forja repetida con el mismo objeto no infla la cuenta', async () => {
    const firmante = await nuevoFirmante();
    const bytes = await commitFirmado(firmante, mensajeDe(HEX));
    const cruce = await crossCheckForges([
      { forge: 'codeberg', bytes },
      { forge: 'codeberg', bytes },
    ]);
    expect(cruce.kind).toBe('acuerdo');
    if (cruce.kind !== 'acuerdo') return;
    // Se registra lo que pasó —dos respuestas— y es `verify` quien decide qué cuenta: aquí no se
    // toman decisiones de política, sólo se compara.
    expect(cruce.forges).toStrictEqual(['codeberg', 'codeberg']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `poll()` — lo mismo, pero contra las forjas
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('SignedGitProvider.poll', () => {
  it('las dos forjas con el mismo commit ⇒ recibo confirmado con las dos apuntadas', async () => {
    const firmante = await nuevoFirmante();
    const bytes = await commitFirmado(firmante, mensajeDe(HEX));
    const provider = proveedor(firmante, [
      await forjaCon('codeberg', bytes),
      await forjaCon('github', bytes),
    ]);

    const recibo = await provider.poll(solicitud());

    expect(recibo.externalRef).toBe(await commitOid(bytes));
    expect(recibo.confirmedAt).toBe(T_AHORA);
    expect(recibo.raw['forgesSeen']).toStrictEqual(['codeberg', 'github']);
    expect((await provider.verify(recibo, CHECKPOINT)).status).toBe('confirmado');
  });

  it('UNA forja reescrita con `push --force` hace fallar el `poll` a gritos', async () => {
    const veeduria = await nuevoFirmante();
    const legitimo = await commitFirmado(veeduria, mensajeDe(HEX, 'Checkpoint 12480'));
    const reescrito = await commitFirmado(veeduria, mensajeDe(HEX, 'Checkpoint 12480 rehecho'));

    const provider = proveedor(veeduria, [
      await forjaCon('codeberg', legitimo),
      await forjaCon('github', reescrito),
    ]);

    const error = await provider.poll(solicitud()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForgeDivergenceError);
    const divergencia = error as ForgeDivergenceError;
    expect(divergencia.reason).toBe('objetos-distintos');
    expect(divergencia.checkpointHash).toBe(HEX);
    expect(divergencia.variants).toHaveLength(2);
    expect(divergencia.message).toMatch(/las forjas discrepan sobre el anclaje de 7e7e7e7e/u);
  });

  it('discrepan aunque el commit falso esté firmado por la MISMA clave del padrón', async () => {
    // Es el caso realista: quien reescribe convence a la veeduría de firmar otra vez, o le roba la
    // clave. La firma es válida en los dos, y aun así las forjas no dicen lo mismo.
    const veeduria = await nuevoFirmante();
    const a = await commitFirmado(veeduria, mensajeDe(HEX), { tree: 'a'.repeat(40) });
    const b = await commitFirmado(veeduria, mensajeDe(HEX), { tree: 'b'.repeat(40) });
    const provider = proveedor(veeduria, [
      await forjaCon('codeberg', a),
      await forjaCon('github', b),
    ]);

    await expect(provider.poll(solicitud())).rejects.toThrow(ForgeDivergenceError);
  });

  it('una forja que va con RETRASO no es una discrepancia: es una forja que va con retraso', async () => {
    // Sin filtrar por la línea de compromiso, el retraso normal entre dos forjas dispararía la
    // alarma en cada ciclo, y una alarma que salta sola deja de leerse.
    const firmante = await nuevoFirmante();
    const alDia = await commitFirmado(firmante, mensajeDe(HEX));
    const anterior = await commitFirmado(firmante, mensajeDe(OTRO_HEX));

    const provider = proveedor(firmante, [
      await forjaCon('codeberg', alDia),
      await forjaCon('github', anterior),
    ]);

    const recibo = await provider.poll(solicitud());
    expect(recibo.externalRef).toBe(await commitOid(alDia));
    expect(recibo.raw['forgesSeen']).toStrictEqual(['codeberg']);
    expect(recibo.raw['forgesSinAncla']).toStrictEqual(['github']);
  });

  it('con una sola forja el anclaje se confirma, pero la otra queda como afirmación pendiente', async () => {
    const firmante = await nuevoFirmante();
    const bytes = await commitFirmado(firmante, mensajeDe(HEX));
    const provider = proveedor(firmante, [await forjaCon('codeberg', bytes), forjaVacia('github')]);

    const recibo = await provider.poll(solicitud());
    const resultado = await provider.verify(recibo, CHECKPOINT);

    expect(recibo.raw['forgesSeen']).toStrictEqual(['codeberg']);
    expect(resultado.status).toBe('confirmado');
    expect(resultado.residualClaims.map((r) => r.claim)).toContain(
      'el recibo dice haber visto el commit en 1 forja(s) del padrón y hacen falta 2',
    );
  });

  it('si ninguna forja tiene el commit, el recibo sigue pendiente y no se inventa nada', async () => {
    const firmante = await nuevoFirmante();
    const provider = proveedor(firmante, [forjaVacia('codeberg'), forjaVacia('github')]);

    const recibo = await provider.poll(solicitud());
    expect(recibo.confirmedAt).toBeUndefined();
    expect(recibo.proof).toBeUndefined();
    expect((await provider.verify(recibo, CHECKPOINT)).status).toBe('pendiente');
  });

  it('si TODAS las forjas revientan, se lanza en vez de devolver «todavía no»', async () => {
    const firmante = await nuevoFirmante();
    const provider = proveedor(firmante, [forjaRota('codeberg'), forjaRota('github')]);
    await expect(provider.poll(solicitud())).rejects.toThrow(/ninguna forja respondió/u);
  });

  it('una forja rota y otra sana: el anclaje se confirma y el error queda escrito', async () => {
    const firmante = await nuevoFirmante();
    const bytes = await commitFirmado(firmante, mensajeDe(HEX));
    const provider = proveedor(firmante, [await forjaCon('codeberg', bytes), forjaRota('github')]);

    const recibo = await provider.poll(solicitud());
    expect(recibo.raw['forgesSeen']).toStrictEqual(['codeberg']);
    expect(recibo.raw['forgesConError']).toStrictEqual(['github: 502 Bad Gateway']);
  });

  it('con el OID ya conocido se pide EL MISMO a las dos, y servir otro es discrepancia', async () => {
    const firmante = await nuevoFirmante();
    const legitimo = await commitFirmado(firmante, mensajeDe(HEX));
    const oid = await commitOid(legitimo);
    const impostor = await commitFirmado(firmante, mensajeDe(HEX, 'otro'));

    // `github` responde al OID que se le pide… con otro objeto. Eso es una forja que miente.
    const mentirosa: GitForgeClient = {
      name: 'github',
      fetchCommit: () => Promise.resolve(impostor),
      head: () => Promise.resolve(oid),
    };
    const provider = proveedor(firmante, [await forjaCon('codeberg', legitimo), mentirosa]);

    const confirmado: AnchorReceipt = { ...solicitud(), externalRef: oid };
    await expect(provider.poll(confirmado)).rejects.toThrow(ForgeDivergenceError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `verify()` — el recibo es un dato hostil
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('forjas declaradas en el recibo', () => {
  it('inventar nombres de forja no sube la cuenta: se recorta al padrón', async () => {
    const firmante = await nuevoFirmante();
    const bytes = await commitFirmado(firmante, mensajeDe(HEX));
    const provider = proveedor(firmante, []);

    const recibo: AnchorReceipt = {
      provider: 'git',
      independenceClass: 'vcs',
      checkpointHash: HEX,
      externalRef: await commitOid(bytes),
      submittedAt: T_EMISION,
      confirmedAt: T_AHORA,
      proof: Buffer.from(bytes).toString('base64url'),
      raw: { forgesSeen: ['gitlab-del-atacante', 'mi-servidor', 'codeberg'] },
    };

    const resultado = await provider.verify(recibo, CHECKPOINT);
    expect(resultado.checks.find((c) => c.name === 'forjas_declaradas')).toMatchObject({
      ok: false,
    });
    expect(resultado.residualClaims.map((r) => r.claim)).toContain(
      'el recibo dice haber visto el commit en 1 forja(s) del padrón y hacen falta 2',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Y lo que pasa en el ciclo completo: la discrepancia queda DENTRO del ledger
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('el ciclo de anclaje ante una discrepancia entre forjas', () => {
  it('escribe AnclajeFallido con el motivo, no confirma, y el quórum no es firme', async () => {
    const veeduria = await nuevoFirmante();
    const legitimo = await commitFirmado(veeduria, mensajeDe(HEX, 'Checkpoint 12480'));
    const reescrito = await commitFirmado(veeduria, mensajeDe(HEX, 'Checkpoint 12480 rehecho'));

    const provider = proveedor(veeduria, [
      await forjaCon('codeberg', legitimo),
      await forjaCon('github', reescrito),
    ]);

    const resultado = await runAnchorCycle({
      checkpoint: checkpointRefFromHex({
        treeSize: 12_480n,
        rootHash: 'a'.repeat(64),
        headsRoot: 'b'.repeat(64),
        checkpointHash: HEX,
        issuedAt: T_EMISION,
      }),
      providers: [provider],
      now: T_AHORA,
      poll: true,
    });

    const fallidos = resultado.events.filter((e) => e.eventType === ANCHOR_FAILED);
    expect(fallidos).toHaveLength(1);
    const motivo = fallidos[0]!.payload['motivo'];
    expect(typeof motivo).toBe('string');
    expect(motivo as string).toMatch(/las forjas discrepan/u);
    expect(motivo as string).toMatch(/push --force/u);

    expect(resultado.events.filter((e) => e.eventType === ANCHOR_CONFIRMED)).toHaveLength(0);
    expect(resultado.verdict.firm).toBe(false);
    expect(resultado.verdict.state).toBe('NO_ANCLADO');
  });
});
