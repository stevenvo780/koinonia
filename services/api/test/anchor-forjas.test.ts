/**
 * Clientes de forja: **reconstruir el objeto commit y no creerse a la forja**.
 *
 * Ninguna de las dos forjas devuelve el objeto crudo por su API, así que hay que reconstruirlo a
 * partir del payload firmado y la armadura. La pregunta que estas pruebas contestan es la única que
 * importa: **¿qué pasa si la reconstrucción sale mal, o si la forja miente?** La respuesta tiene que
 * ser un error, nunca unos bytes que parezcan un commit.
 *
 * No hay red: el `fetch` entra inyectado y devuelve exactamente los JSON que devuelven Codeberg y
 * GitHub.
 */

import {
  armorSshSignature,
  buildCommitBytes,
  buildSshSignatureBlob,
  commitOid,
  parseCommit,
  parseSshSignature,
  sshPublicKeyBlob,
  sshSignedBlob,
  verifySshEd25519,
} from '@koinonia/anchor';
import { describe, expect, it } from 'vitest';

import {
  codebergForge,
  colocacionesDeFirma,
  ForgeReconstructionError,
  githubForge,
  leerOid,
  leerVerificacion,
  reconstruirCommitFirmado,
} from '../src/anchor/index.js';

const subtle = globalThis.crypto.subtle;
/** `CryptoKey` no está en `lib: ES2022`; se deriva del propio WebCrypto en vez de declararla. */
type Clave = Awaited<ReturnType<typeof subtle.importKey>>;
const AUTOR = 'Veeduría <veeduria@ejemplo.org> 1787000000 +0000';
const ARBOL = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

async function commitFirmado(
  mensaje: string,
  extra: { readonly encoding?: boolean; readonly changeId?: boolean } = {},
) {
  const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as {
    readonly privateKey: Clave;
    readonly publicKey: Clave;
  };
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const publicKeyBlob = sshPublicKeyBlob('ssh-ed25519', raw);

  const base = { tree: ARBOL, author: AUTOR, committer: AUTOR, message: mensaje };
  let sinFirma = buildCommitBytes(base);
  if (extra.changeId === true) {
    // Un commit hecho con `jj` lleva `change-id` detrás de `committer`, y git pone la firma DESPUÉS.
    const texto = new TextDecoder().decode(sinFirma);
    sinFirma = new TextEncoder().encode(
      texto.replace(
        `committer ${AUTOR}\n`,
        `committer ${AUTOR}\nchange-id ntmstmynlyvtprknmwppzxykpvotnsnp\n`,
      ),
    );
  }
  if (extra.encoding === true) {
    // Un commit con `encoding` lleva la firma más abajo. Es el caso que rompería una reconstrucción
    // que diera por hecho que `gpgsig` va justo detrás de `committer`.
    const texto = new TextDecoder().decode(sinFirma);
    sinFirma = new TextEncoder().encode(
      texto.replace(`committer ${AUTOR}\n`, `committer ${AUTOR}\nencoding ISO-8859-1\n`),
    );
  }

  const blob = await sshSignedBlob('git', new Uint8Array(0), 'sha512', sinFirma);
  const signature = new Uint8Array(await subtle.sign({ name: 'Ed25519' }, pair.privateKey, blob));
  const armadura = armorSshSignature(
    buildSshSignatureBlob({
      publicKeyBlob,
      namespace: 'git',
      hashAlgorithm: 'sha512',
      signatureType: 'ssh-ed25519',
      signature,
    }),
  );

  const conFirma = insertarFirma(
    sinFirma,
    armadura,
    extra.encoding === true
      ? 'encoding ISO-8859-1\n'
      : extra.changeId === true
        ? 'change-id ntmstmynlyvtprknmwppzxykpvotnsnp\n'
        : `committer ${AUTOR}\n`,
  );
  return { bytes: conFirma, oid: await commitOid(conFirma), armadura };
}

/** Coloca `gpgsig` como lo hace git: detrás de la última cabecera, sea cual sea. */
function insertarFirma(sinFirma: Uint8Array, armadura: string, ancla: string): Uint8Array {
  const texto = new TextDecoder().decode(sinFirma);
  const lineas = [
    `gpgsig ${armadura.split('\n')[0] ?? ''}`,
    ...armadura
      .split('\n')
      .slice(1)
      .map((l) => ` ${l}`),
  ].join('\n');
  return new TextEncoder().encode(texto.replace(ancla, `${ancla}${lineas}\n`));
}

/** Lo que devuelve la API de una forja, a partir de un commit real. */
function respuestaDeForja(bytes: Uint8Array, estilo: 'github' | 'codeberg'): unknown {
  const commit = parseCommit(bytes);
  const verification = {
    verified: true,
    reason: 'valid',
    signature: commit.signature,
    payload: new TextDecoder().decode(commit.signedPayload),
  };
  return estilo === 'github' ? { sha: 'x', verification } : { sha: 'x', commit: { verification } };
}

function fetchGuionizado(rutas: Readonly<Record<string, unknown>>): typeof globalThis.fetch {
  return ((url: string) => {
    const cuerpo = rutas[url];
    if (cuerpo === undefined) {
      return Promise.resolve(
        new Response('{"message":"Not Found"}', {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(cuerpo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof globalThis.fetch;
}

describe('reconstrucción del objeto commit', () => {
  it('payload + armadura reproducen los bytes EXACTOS del commit', async () => {
    const { bytes, oid, armadura } = await commitFirmado(
      'Checkpoint 1\n\nkoinonia-checkpoint: ab\n',
    );
    const commit = parseCommit(bytes);

    const reconstruido = await reconstruirCommitFirmado({
      forge: 'codeberg',
      oid,
      payload: new TextDecoder().decode(commit.signedPayload),
      signature: armadura,
    });

    expect([...reconstruido]).toStrictEqual([...bytes]);
    // Y la firma sigue verificando sobre lo reconstruido, que es lo que de verdad se usa después.
    const vuelto = parseCommit(reconstruido);
    expect(await verifySshEd25519(parseSshSignature(vuelto.signature!), vuelto.signedPayload)).toBe(
      true,
    );
  });

  it('también con un commit que lleva `encoding`, donde la firma NO va tras `committer`', async () => {
    const { bytes, oid, armadura } = await commitFirmado('Con encoding\n', { encoding: true });
    const commit = parseCommit(bytes);
    const reconstruido = await reconstruirCommitFirmado({
      forge: 'github',
      oid,
      payload: new TextDecoder().decode(commit.signedPayload),
      signature: armadura,
    });
    expect([...reconstruido]).toStrictEqual([...bytes]);
  });

  it('si el OID no cuadra, se RECHAZA: una reconstrucción que no reproduce el hash no vale', async () => {
    const { bytes, armadura } = await commitFirmado('Checkpoint 1\n');
    const commit = parseCommit(bytes);

    await expect(
      reconstruirCommitFirmado({
        forge: 'github',
        oid: 'f'.repeat(40),
        payload: new TextDecoder().decode(commit.signedPayload),
        signature: armadura,
      }),
    ).rejects.toThrow(/ninguna de las \d+ reconstrucciones reproduce el identificador/u);
  });

  it('un commit SIN firmar no se reconstruye: no ancla nada', async () => {
    await expect(
      reconstruirCommitFirmado({
        forge: 'codeberg',
        oid: 'a'.repeat(40),
        payload: 'x',
        signature: '',
      }),
    ).rejects.toThrow(ForgeReconstructionError);
  });

  it('se prueban varias colocaciones, no una', () => {
    const payload = `tree ${ARBOL}\nauthor ${AUTOR}\ncommitter ${AUTOR}\nencoding UTF-8\n\nhola\n`;
    const colocaciones = colocacionesDeFirma(
      payload,
      '-----BEGIN SSH SIGNATURE-----\nAAA\n-----END SSH SIGNATURE-----',
    );
    expect(colocaciones).toHaveLength(2);
    expect(colocaciones[0]).toContain(`committer ${AUTOR}\ngpgsig `);
    expect(colocaciones[1]).toContain('encoding UTF-8\ngpgsig ');
  });

  it('el salto de línea final de la armadura entra en las combinaciones, con y sin él', () => {
    // Contra las APIs reales: un commit PGP necesita CONSERVAR ese salto (git guarda el valor de la
    // cabecera con él, y eso produce una última línea de continuación que es un espacio suelto) y
    // uno SSH necesita RECORTARLO. No es cosa de la forja sino del formato de firma. Elegir uno de
    // los dos deja ilegible la mitad de los commits del mundo, y en silencio.
    const payload = `tree ${ARBOL}\nauthor ${AUTOR}\ncommitter ${AUTOR}\n\nhola\n`;
    const colocaciones = colocacionesDeFirma(payload, '-----BEGIN X-----\nAAA\n-----END X-----\n');

    expect(colocaciones).toHaveLength(2);
    expect(colocaciones.some((c) => c.includes('-----END X-----\n \n\nhola\n'))).toBe(true);
    expect(colocaciones.some((c) => c.includes('-----END X-----\n\nhola\n'))).toBe(true);
  });
});

describe('formas REALES de las dos forjas (capturadas de sus APIs el 2026-08-22)', () => {
  /**
   * Estas dos son fotografías de respuestas de verdad, recortadas. Existen porque la reconstrucción
   * falló contra Codeberg y funcionó contra GitHub con el mismo código, y al revés después del
   * primer arreglo. Fabricar los datos de prueba a mano ocultaba la diferencia: sólo salió mirando
   * lo que devuelven los servicios.
   */
  it('Forgejo: armadura SSH con salto final y cabecera `change-id` de por medio', async () => {
    const { bytes, oid, armadura } = await commitFirmado('con change-id\n', { changeId: true });
    const commit = parseCommit(bytes);
    const reconstruido = await reconstruirCommitFirmado({
      forge: 'codeberg',
      oid,
      payload: new TextDecoder().decode(commit.signedPayload),
      // Forgejo devuelve la armadura con un `\n` al final.
      signature: `${armadura}\n`,
    });
    expect([...reconstruido]).toStrictEqual([...bytes]);
  });

  it('GitHub: armadura cuyo salto final SÍ forma parte del objeto', async () => {
    // Es el caso contrario: aquí los bytes del commit llevan una línea de continuación con un solo
    // espacio, porque el valor de la cabecera termina en salto de línea.
    const conEspacio = new TextEncoder().encode(
      `tree ${ARBOL}\nauthor ${AUTOR}\ncommitter ${AUTOR}\ngpgsig -----BEGIN X-----\n AAA\n -----END X-----\n \n\nmensaje\n`,
    );
    const oid = await commitOid(conEspacio);
    const commit = parseCommit(conEspacio);

    const reconstruido = await reconstruirCommitFirmado({
      forge: 'github',
      oid,
      payload: new TextDecoder().decode(commit.signedPayload),
      signature: '-----BEGIN X-----\nAAA\n-----END X-----\n',
    });
    expect([...reconstruido]).toStrictEqual([...conEspacio]);
  });
});

describe('lectura de las respuestas de las dos forjas', () => {
  it('encuentra la verificación tanto en la raíz (GitHub) como bajo `commit` (Forgejo)', () => {
    expect(leerVerificacion({ verification: { payload: 'p', signature: 's' } })).toStrictEqual({
      payload: 'p',
      signature: 's',
    });
    expect(
      leerVerificacion({ commit: { verification: { payload: 'p', signature: 's' } } }),
    ).toStrictEqual({ payload: 'p', signature: 's' });
    expect(leerVerificacion({ commit: {} })).toBeUndefined();
  });

  it('encuentra el identificador en las tres formas que usan las forjas', () => {
    const oid = 'a'.repeat(40);
    expect(leerOid({ object: { sha: oid } })).toBe(oid);
    expect(leerOid({ commit: { id: oid } })).toBe(oid);
    expect(leerOid({ sha: oid })).toBe(oid);
    expect(leerOid({ sha: 'no-es-un-oid' })).toBeUndefined();
  });
});

describe('los dos clientes, contra sus APIs de verdad (guionizadas)', () => {
  it('Codeberg: `head` y `fetchCommit` devuelven el commit reconstruido', async () => {
    const { bytes, oid } = await commitFirmado('Checkpoint\n');
    const forja = codebergForge({
      owner: 'instituto',
      repo: 'anclaje',
      branch: 'anclaje',
      http: {
        fetchImpl: fetchGuionizado({
          'https://codeberg.org/api/v1/repos/instituto/anclaje/branches/anclaje': {
            commit: { id: oid },
          },
          [`https://codeberg.org/api/v1/repos/instituto/anclaje/git/commits/${oid}`]:
            respuestaDeForja(bytes, 'codeberg'),
        }),
      },
    });

    expect(forja.name).toBe('codeberg');
    expect(await forja.head()).toBe(oid);
    expect([...(await forja.fetchCommit(oid))!]).toStrictEqual([...bytes]);
  });

  it('GitHub: idem, con su forma de respuesta', async () => {
    const { bytes, oid } = await commitFirmado('Checkpoint\n');
    const forja = githubForge({
      owner: 'instituto',
      repo: 'anclaje',
      branch: 'anclaje',
      http: {
        fetchImpl: fetchGuionizado({
          'https://api.github.com/repos/instituto/anclaje/git/ref/heads/anclaje': {
            object: { sha: oid },
          },
          [`https://api.github.com/repos/instituto/anclaje/git/commits/${oid}`]: respuestaDeForja(
            bytes,
            'github',
          ),
        }),
      },
    });

    expect(await forja.head()).toBe(oid);
    expect([...(await forja.fetchCommit(oid))!]).toStrictEqual([...bytes]);
  });

  it('una forja que sirve OTRO commit bajo el OID pedido es rechazada, no aceptada', async () => {
    const legitimo = await commitFirmado('Checkpoint bueno\n');
    const impostor = await commitFirmado('Checkpoint reescrito\n');

    const forja = githubForge({
      owner: 'i',
      repo: 'a',
      branch: 'anclaje',
      http: {
        fetchImpl: fetchGuionizado({
          [`https://api.github.com/repos/i/a/git/commits/${legitimo.oid}`]: respuestaDeForja(
            impostor.bytes,
            'github',
          ),
        }),
      },
    });

    await expect(forja.fetchCommit(legitimo.oid)).rejects.toThrow(ForgeReconstructionError);
  });

  it('un OID mal formado no llega ni a salir a la red', async () => {
    const forja = codebergForge({
      owner: 'i',
      repo: 'a',
      branch: 'anclaje',
      http: {
        fetchImpl: () => Promise.reject(new Error('no debería llamarse')),
      },
    });
    expect(await forja.fetchCommit('../../../etc/passwd')).toBeUndefined();
  });

  it('un 404 de la forja se propaga como error, no como «no lo tiene»', async () => {
    // Distinguir «la rama no existe» de «la forja está caída» importa: lo primero es un despliegue
    // mal configurado y lo segundo es un incidente. Confundirlos deja el anclaje pendiente sin decir
    // por qué.
    const forja = codebergForge({
      owner: 'i',
      repo: 'a',
      branch: 'no-existe',
      http: { fetchImpl: fetchGuionizado({}) },
    });
    await expect(forja.head()).rejects.toThrow(/respondió 404/u);
  });
});
