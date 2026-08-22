/**
 * El **enganche** del anclaje: configuración por entorno y cosecha de cabeceras de bloque.
 *
 * Lo que se prueba aquí no es el anclaje —eso ya tiene sus pruebas— sino las tres decisiones que
 * convierten un anclaje construido en un anclaje que ocurre, y las tres se pueden equivocar en
 * silencio:
 *
 *  1. Que un despliegue mal configurado **apague** el proveedor en vez de arrancarlo a medias.
 *  2. Que `signingKeyOffHost` valga `false` por defecto, para que la clave dentro del servidor
 *     produzca un anclaje que no cuenta en vez de un anclaje impecable de una mentira.
 *  3. Que la cabecera de bloque que se guarda sea la del bloque que se pidió. Sin esta comprobación,
 *     un intermediario que devuelva bytes cambiados nos hace publicar en el export una cabecera que
 *     no cierra nada, y el fallo se descubriría en una asamblea.
 */

import {
  FakeOtsCalendar,
  OpenTimestampsProvider,
  type AnchorReceipt,
  type BitcoinHeaderSource,
} from '@koinonia/anchor';
import { sha256, toHex } from '@koinonia/crypto';
import { describe, expect, it } from 'vitest';

import {
  alturasAncladas,
  configuracionDeAnclajeDesdeEntorno,
  cosecharCabeceras,
  exploradorDeBloques,
  parsearFirmantes,
  parsearTestigos,
} from '../src/anchor/index.js';
import { type PgClient } from '../src/db/client.js';

const AHORA = '2026-08-21T04:00:00.000Z';
const CHECKPOINT = new Uint8Array(32).fill(0x6b);

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Padrones
// ═════════════════════════════════════════════════════════════════════════════════════════════

const CLAVE = 'AAAAC3NzaC1lZDI1NTE5AAAAIGxvcmVtaXBzdW1kb2xvcnNpdGFtZXRjb25zZQ';

describe('padrón de firmantes desde el entorno', () => {
  it('lee la forma «identidad|clave»', () => {
    expect(parsearFirmantes(`Veeduría 2026-2|${CLAVE}`)).toStrictEqual([
      { identity: 'Veeduría 2026-2', publicKey: CLAVE },
    ]);
  });

  it('lee una línea de allowed_signers pegada tal cual, que es lo que alguien tiene delante', () => {
    expect(parsearFirmantes(`maria@ejemplo.org ssh-ed25519 ${CLAVE}`)).toStrictEqual([
      { identity: 'maria@ejemplo.org', publicKey: CLAVE },
    ]);
  });

  it('admite varias entradas separadas por punto y coma', () => {
    expect(parsearFirmantes(`Ana|${CLAVE}; Beto|${CLAVE}`)).toHaveLength(2);
  });

  it('rechaza una entrada sin clave en vez de admitir un firmante fantasma', () => {
    expect(() => parsearFirmantes('Veeduría 2026-2|')).toThrow(/incompleta/u);
  });

  it('rechaza lo que no reconoce: un padrón mal leído admitiría firmas ajenas', () => {
    expect(() => parsearFirmantes('sólo un nombre')).toThrow(/no se reconoce/u);
  });
});

describe('padrón de testigos desde el entorno', () => {
  it('lee id, correo y clave', () => {
    expect(parsearTestigos(`docente|ana@correo.example|${CLAVE}`)).toStrictEqual([
      { id: 'docente', address: 'ana@correo.example', publicKey: CLAVE },
    ]);
  });

  it('admite un testigo sin clave: acusa recibo aunque su acuse no cuente', () => {
    expect(parsearTestigos('externa|carla@otra.example|')[0]?.publicKey).toBe('');
  });

  it('rechaza un correo que no lo es', () => {
    expect(() => parsearTestigos('docente|no-es-un-correo|')).toThrow(/no parece un correo/u);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Configuración
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('configuración del anclaje', () => {
  it('está apagada fuera de producción y encendida dentro, sin decir nada', () => {
    expect(configuracionDeAnclajeDesdeEntorno({}, { produccion: false }).activo).toBe(false);
    expect(configuracionDeAnclajeDesdeEntorno({}, { produccion: true }).activo).toBe(true);
  });

  it('KOINONIA_ANCLAJE manda sobre el defecto en los dos sentidos', () => {
    const encendido = configuracionDeAnclajeDesdeEntorno(
      { KOINONIA_ANCLAJE: 'sí' },
      { produccion: false },
    );
    const apagado = configuracionDeAnclajeDesdeEntorno(
      { KOINONIA_ANCLAJE: 'no' },
      { produccion: true },
    );
    expect([encendido.activo, apagado.activo]).toStrictEqual([true, false]);
  });

  it('un valor mal escrito NO enciende nada', () => {
    expect(
      configuracionDeAnclajeDesdeEntorno({ KOINONIA_ANCLAJE: 'quizás' }, { produccion: false })
        .activo,
    ).toBe(false);
  });

  it('sin firmantes ni testigos deja fuera git y correo, y dice por qué', () => {
    const config = configuracionDeAnclajeDesdeEntorno({}, { produccion: true });
    expect(config.git).toBeUndefined();
    expect(config.correo).toBeUndefined();
    expect(config.motivosDeAusencia.join('\n')).toMatch(/KOINONIA_ANCLAJE_FIRMANTES/u);
    expect(config.motivosDeAusencia.join('\n')).toMatch(/padrón de testigos/u);
  });

  it('signingKeyOffHost es FALSE por defecto: la mentira cómoda hay que escribirla', () => {
    const config = configuracionDeAnclajeDesdeEntorno(
      { KOINONIA_ANCLAJE_FIRMANTES: `Veeduría|${CLAVE}` },
      { produccion: true },
    );
    expect(config.git?.signingKeyOffHost).toBe(false);
    expect(config.motivosDeAusencia.join('\n')).toMatch(/NO cuenta para el quórum/u);
  });

  it('declarada, no hay aviso y el anclaje de git cuenta', () => {
    const config = configuracionDeAnclajeDesdeEntorno(
      {
        KOINONIA_ANCLAJE_FIRMANTES: `Veeduría|${CLAVE}`,
        KOINONIA_ANCLAJE_CLAVE_FUERA_DEL_SERVIDOR: '1',
      },
      { produccion: true },
    );
    expect(config.git?.signingKeyOffHost).toBe(true);
    expect(config.motivosDeAusencia.join('\n')).not.toMatch(/NO cuenta para el quórum/u);
  });

  it('lee los repositorios de las forjas y rechaza uno mal escrito', () => {
    const config = configuracionDeAnclajeDesdeEntorno(
      {
        KOINONIA_ANCLAJE_FIRMANTES: `Veeduría|${CLAVE}`,
        KOINONIA_ANCLAJE_CODEBERG_REPO: 'koinonia/anclaje',
        KOINONIA_ANCLAJE_GITHUB_REPO: 'koinonia/anclaje',
        KOINONIA_ANCLAJE_GITHUB_RAMA: 'sellos',
      },
      { produccion: true },
    );
    expect(config.git?.repos.map((r) => `${r.tipo}:${r.branch}`)).toStrictEqual([
      'codeberg:anclaje',
      'github:sellos',
    ]);

    expect(() =>
      configuracionDeAnclajeDesdeEntorno(
        {
          KOINONIA_ANCLAJE_FIRMANTES: `Veeduría|${CLAVE}`,
          KOINONIA_ANCLAJE_CODEBERG_REPO: 'sin-barra',
        },
        { produccion: true },
      ),
    ).toThrow(/propietario\/repositorio/u);
  });

  it('con testigos y SMTP pero sin IMAP avisa de que nadie recogerá los acuses', () => {
    const config = configuracionDeAnclajeDesdeEntorno(
      {
        KOINONIA_ANCLAJE_TESTIGOS: `docente|ana@correo.example|${CLAVE}`,
        KOINONIA_ANCLAJE_SMTP_HOST: 'smtp.udea.edu.co',
        KOINONIA_ANCLAJE_CORREO_FROM: 'Anclaje <anclaje@udea.edu.co>',
      },
      { produccion: true },
    );
    expect(config.correo?.envelopeFrom).toBe('anclaje@udea.edu.co');
    expect(config.correo?.smtp.tls).toBe('starttls');
    expect(config.motivosDeAusencia.join('\n')).toMatch(/NADIE recoge sus acuses/u);
  });

  it('el usuario y la clave de SMTP van juntos o no van', () => {
    expect(() =>
      configuracionDeAnclajeDesdeEntorno(
        {
          KOINONIA_ANCLAJE_TESTIGOS: `docente|ana@correo.example|${CLAVE}`,
          KOINONIA_ANCLAJE_SMTP_HOST: 'smtp.udea.edu.co',
          KOINONIA_ANCLAJE_CORREO_FROM: 'Anclaje <anclaje@udea.edu.co>',
          KOINONIA_ANCLAJE_SMTP_USUARIO: 'anclaje',
        },
        { produccion: true },
      ),
    ).toThrow(/van juntas o no van/u);
  });

  it('apagado el anclaje, no se construye nada aunque haya configuración', () => {
    const config = configuracionDeAnclajeDesdeEntorno(
      { KOINONIA_ANCLAJE: 'no', KOINONIA_ANCLAJE_FIRMANTES: `Veeduría|${CLAVE}` },
      { produccion: true },
    );
    expect(config.git).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Cabeceras de bloque
// ═════════════════════════════════════════════════════════════════════════════════════════════

async function blockIdDe(header: Uint8Array): Promise<string> {
  return toHex(Uint8Array.from([...(await sha256(await sha256(header)))].reverse()));
}

function respuesta(texto: string, status = 200): Response {
  return new Response(texto, { status });
}

/** `fetch` admite varias formas de destino; el cliente del anclaje siempre pasa cadena. */
function ruta(url: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof url === 'string') return url;
  if (url instanceof URL) return url.href;
  return url.url;
}

/**
 * Una cabecera de bloque **real** del calendario falso.
 *
 * `FakeOtsCalendar` no tiene cabeceras hasta que un sello madura: las fabrica en `upgrade()`, que
 * es lo mismo que hace un calendario de verdad —el bloque no existe hasta que existe—. Sellar
 * primero no es ceremonia: pedirle `headers()` a un calendario recién construido devuelve un mapa
 * vacío, y con él estas pruebas no probarían nada.
 */
async function cabeceraReal(
  firstHeight: number,
  firstBlockTime: number,
): Promise<{ altura: number; cabecera: Uint8Array }> {
  const calendario = new FakeOtsCalendar({ firstHeight, firstBlockTime });
  const proveedor = new OpenTimestampsProvider({
    calendar: calendario,
    headers: calendario.headerSource(),
    clock: () => AHORA,
  });
  await proveedor.poll(await proveedor.submit(CHECKPOINT));
  const [entrada] = [...calendario.headers()];
  if (entrada === undefined) throw new Error('el calendario falso no fabricó ninguna cabecera');
  return { altura: entrada[0], cabecera: entrada[1] };
}

describe('explorador de bloques', () => {
  it('pide la altura, luego la cabecera, y comprueba que los bytes son los del bloque pedido', async () => {
    const { altura, cabecera } = await cabeceraReal(921_447, 1_787_200_000);
    const id = await blockIdDe(cabecera);

    const pedidas: string[] = [];
    const fuente = exploradorDeBloques('https://bloques.example/api/', {
      fetchImpl: (url) => {
        const camino = ruta(url);
        pedidas.push(camino);
        if (camino.endsWith(`/block-height/${String(altura)}`)) {
          return Promise.resolve(respuesta(`${id}\n`));
        }
        if (camino === `https://bloques.example/api/block/${id}/header`) {
          return Promise.resolve(respuesta(toHex(cabecera)));
        }
        return Promise.resolve(respuesta('no', 404));
      },
    });

    expect(await fuente.obtener(altura)).toStrictEqual(cabecera);
    expect(pedidas).toStrictEqual([
      `https://bloques.example/api/block-height/${String(altura)}`,
      `https://bloques.example/api/block/${id}/header`,
    ]);
  });

  it('RECHAZA una cabecera que no hashea al identificador que se pidió', async () => {
    const { altura, cabecera } = await cabeceraReal(700_000, 1_600_000_000);
    const falsificada = Uint8Array.from(cabecera);
    falsificada[36] = (falsificada[36] ?? 0) ^ 0xff; // un byte de la raíz de Merkle
    const id = await blockIdDe(cabecera);

    const fuente = exploradorDeBloques('https://bloques.example/api', {
      fetchImpl: (url) =>
        Promise.resolve(
          ruta(url).includes('/block-height/') ? respuesta(id) : respuesta(toHex(falsificada)),
        ),
    });

    await expect(fuente.obtener(altura)).rejects.toThrow(/no corresponde a su identificador/u);
  });

  it('rechaza una respuesta que no es un identificador de bloque', async () => {
    const fuente = exploradorDeBloques('https://bloques.example/api', {
      fetchImpl: () => Promise.resolve(respuesta('<html>error</html>')),
    });
    await expect(fuente.obtener(1)).rejects.toThrow(/no es un identificador de bloque/u);
  });
});

describe('cosecha de cabeceras', () => {
  /** El recibo de un sello YA maduro: el `FakeOtsCalendar` lo asciende en el `poll`. */
  async function reciboMaduro(): Promise<{
    receipt: AnchorReceipt;
    headers: ReadonlyMap<number, Uint8Array>;
    source: BitcoinHeaderSource;
  }> {
    const calendario = new FakeOtsCalendar({
      firstHeight: 921_447,
      firstBlockTime: 1_787_200_000,
    });
    const proveedor = new OpenTimestampsProvider({
      calendar: calendario,
      headers: calendario.headerSource(),
      clock: () => AHORA,
    });
    const inicial = await proveedor.submit(CHECKPOINT);
    return {
      receipt: await proveedor.poll(inicial),
      headers: new Map(calendario.headers()),
      source: calendario.headerSource(),
    };
  }

  it('saca las alturas de los BYTES del sello, no del campo informativo `raw`', async () => {
    const { receipt, headers } = await reciboMaduro();
    expect(await alturasAncladas([receipt])).toStrictEqual(
      [...headers.keys()].sort((a, b) => a - b),
    );
  });

  it('un recibo que no es un sello OTS no es un error: no tiene alturas que cosechar', async () => {
    const ajeno: AnchorReceipt = {
      provider: 'git',
      independenceClass: 'vcs',
      checkpointHash: toHex(CHECKPOINT),
      externalRef: 'oid',
      submittedAt: AHORA,
      proof: 'bm8tZXMtdW4tc2VsbG8',
      raw: {},
    };
    expect(await alturasAncladas([ajeno])).toStrictEqual([]);
  });

  /** Cliente de PostgreSQL de mentira: sólo entiende las tres consultas que la cosecha hace. */
  function clienteFalso(yaEstaban: readonly number[]): {
    client: PgClient;
    guardadas: Map<number, Uint8Array>;
  } {
    const guardadas = new Map<number, Uint8Array>();
    const conocidas = new Set(yaEstaban);
    const client: PgClient = {
      query: (text: string, values?: unknown[]) => {
        if (text.includes('SELECT height')) {
          return Promise.resolve({
            rows: [...conocidas].map((h) => ({ height: String(h) })),
          } as never);
        }
        if (text.includes('INSERT INTO governance.bitcoin_header')) {
          const [altura, bytes] = values as [string, Buffer];
          guardadas.set(Number(altura), new Uint8Array(bytes));
          conocidas.add(Number(altura));
          return Promise.resolve({ rows: [] } as never);
        }
        throw new Error(`consulta inesperada: ${text}`);
      },
    };
    return { client, guardadas };
  }

  it('descarga y guarda las cabeceras que faltan', async () => {
    const { receipt, headers } = await reciboMaduro();
    const alturas = await alturasAncladas([receipt]);
    const { client, guardadas } = clienteFalso([]);

    const cosecha = await cosecharCabeceras({
      client,
      receipts: [receipt],
      fuente: { obtener: (h) => Promise.resolve(headers.get(h) ?? new Uint8Array(80)) },
    });

    expect(cosecha.guardadas).toStrictEqual(alturas);
    expect(cosecha.fallos).toStrictEqual([]);
    expect([...guardadas.keys()]).toStrictEqual(alturas);
  });

  it('no le vuelve a pedir a un tercero lo que ya está guardado', async () => {
    const { receipt, headers } = await reciboMaduro();
    const alturas = await alturasAncladas([receipt]);
    const { client } = clienteFalso(alturas);
    let peticiones = 0;

    const cosecha = await cosecharCabeceras({
      client,
      receipts: [receipt],
      fuente: {
        obtener: (h) => {
          peticiones += 1;
          return Promise.resolve(headers.get(h) ?? new Uint8Array(80));
        },
      },
    });

    expect(peticiones).toBe(0);
    expect(cosecha.yaEstaban).toStrictEqual(alturas);
    expect(cosecha.guardadas).toStrictEqual([]);
  });

  it('una cabecera que no se pudo obtener sale en `fallos` con su motivo, no se traga', async () => {
    const { receipt } = await reciboMaduro();
    const { client, guardadas } = clienteFalso([]);

    const cosecha = await cosecharCabeceras({
      client,
      receipts: [receipt],
      fuente: { obtener: () => Promise.reject(new Error('el explorador devolvió 503')) },
    });

    expect(guardadas.size).toBe(0);
    expect(cosecha.guardadas).toStrictEqual([]);
    expect(cosecha.fallos.map((f) => f.motivo)).toStrictEqual(['el explorador devolvió 503']);
  });
});
