/**
 * El **diálogo HTTP con un calendario de OpenTimestamps**, guionizado.
 *
 * Aquí se prueba lo que la comprobación manual (`verificacion-manual.ts`) sólo puede comprobar
 * saliendo a internet: que se pide lo que hay que pedir, a la ruta que hay que pedirlo, y que la
 * respuesta se cose donde va.
 *
 * ═══ La errata que estas pruebas fijan ═══
 *
 * El `upgrade` anterior pedía `GET {uri}/timestamp/{SHA256(checkpoint)}`. El compromiso que el
 * calendario indexa **no es ése**: es el mensaje del nodo donde cuelga la atestación pendiente, ya
 * con el nonce y el resumen que el propio calendario añadió. Contra un calendario real, aquello
 * devolvía `404` siempre, y el sello se quedaba pendiente para siempre sin que nada lo dijera. El
 * `FakeOtsCalendar` no lo detectaba porque recalcula todo desde el digest del fichero.
 */

import {
  applyOp,
  calendarPool,
  DEFAULT_BACKOFF,
  FakeOtsCalendar,
  httpCalendar,
  immediateClock,
  merkleRootOf,
  OpenTimestampsProvider,
  parseDetachedTimestamp,
  pendingCommitments,
  retryingCalendar,
  serializeDetachedTimestamp,
  staticHeaders,
  walk,
  type FetchLike,
  type OtsTimestamp,
} from '@koinonia/anchor';
import { sha256, toHex } from '@koinonia/crypto';
import { describe, expect, it } from 'vitest';

import {
  calendariosDeProduccion,
  esReintentable,
  HttpError,
  nodeFetch,
} from '../src/anchor/index.js';

const CHECKPOINT = new Uint8Array(32).fill(0x6b);
const AHORA = '2026-08-21T04:00:00.000Z';

/** Cabecera de la respuesta detached: magia (31) + versión (1) + op (1) + digest (32). */
const PREFIJO_DETACHED = 31 + 1 + 1 + 32;

/** Lo que devuelve un calendario en `POST /digest`: el sello SIN cabecera ni digest. */
function timestampSuelto(detached: Uint8Array): Uint8Array {
  return detached.slice(PREFIJO_DETACHED);
}

function cabeceraCon(root: Uint8Array, blockTime: number): Uint8Array {
  const header = new Uint8Array(80);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x2000_0000, true);
  header.set(root, 36);
  view.setUint32(68, blockTime, true);
  return header;
}

function respuesta(
  bytes: Uint8Array,
  status = 200,
): {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
} {
  const copia = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copia).set(bytes);
  return { ok: status >= 200 && status < 300, status, arrayBuffer: () => Promise.resolve(copia) };
}

interface Peticion {
  readonly url: string;
  readonly method: string;
  readonly body: string | undefined;
}

/** `fetch` guionizado que además apunta todo lo que se le pidió. */
function fetchGuionizado(
  responder: (peticion: Peticion) => {
    ok: boolean;
    status: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  },
): { readonly fetchImpl: FetchLike; readonly peticiones: readonly Peticion[] } {
  const peticiones: Peticion[] = [];
  return {
    peticiones,
    fetchImpl: (url, init) => {
      const peticion: Peticion = {
        url,
        method: init?.method ?? 'GET',
        body: init?.body === undefined ? undefined : toHex(init.body),
      };
      peticiones.push(peticion);
      return Promise.resolve(responder(peticion));
    },
  };
}

describe('httpCalendar.stamp', () => {
  it('hace POST a /digest con los 32 bytes del digest y envuelve la respuesta', async () => {
    const fake = new FakeOtsCalendar({ uri: 'https://alice.invalid' });
    const fileDigest = await sha256(CHECKPOINT);
    const suelto = timestampSuelto(await fake.stamp(fileDigest));

    const { fetchImpl, peticiones } = fetchGuionizado(() => respuesta(suelto));
    const bytes = await httpCalendar('https://alice.invalid', fetchImpl).stamp(fileDigest);

    expect(peticiones).toHaveLength(1);
    expect(peticiones[0]?.url).toBe('https://alice.invalid/digest');
    expect(peticiones[0]?.method).toBe('POST');
    expect(peticiones[0]?.body).toBe(toHex(fileDigest));

    const detached = await parseDetachedTimestamp(bytes);
    expect(toHex(detached.fileDigest)).toBe(toHex(fileDigest));
    expect(walk(detached.timestamp)).toHaveLength(1);
  });

  it('un código que no es 2xx se convierte en error, no en un sello vacío', async () => {
    const { fetchImpl } = fetchGuionizado(() => respuesta(new Uint8Array(0), 503));
    await expect(
      httpCalendar('https://alice.invalid', fetchImpl).stamp(await sha256(CHECKPOINT)),
    ).rejects.toThrow(/el calendario https:\/\/alice\.invalid respondió 503/u);
  });

  it('un cuerpo que no es un sello falla AL ENVIAR, no meses después al verificar', async () => {
    const { fetchImpl } = fetchGuionizado(() => respuesta(Uint8Array.from([0xde, 0xad])));
    await expect(
      httpCalendar('https://alice.invalid', fetchImpl).stamp(await sha256(CHECKPOINT)),
    ).rejects.toThrow(/fichero \.ots ilegible/u);
  });
});

describe('httpCalendar.upgrade — pide el COMPROMISO, no el digest del fichero', () => {
  it('la ruta lleva el compromiso pendiente, que no es SHA256(checkpoint)', async () => {
    const fake = new FakeOtsCalendar({ uri: 'https://alice.invalid' });
    const fileDigest = await sha256(CHECKPOINT);
    const sello = await fake.stamp(fileDigest);
    const compromisos = pendingCommitments((await parseDetachedTimestamp(sello)).timestamp);

    expect(compromisos).toHaveLength(1);
    expect(toHex(compromisos[0]!)).not.toBe(toHex(fileDigest));

    const { fetchImpl, peticiones } = fetchGuionizado(() => respuesta(new Uint8Array(0), 404));
    expect(await httpCalendar('https://alice.invalid', fetchImpl).upgrade(sello)).toBeUndefined();

    expect(peticiones).toHaveLength(1);
    expect(peticiones[0]?.url).toBe(`https://alice.invalid/timestamp/${toHex(compromisos[0]!)}`);
    expect(peticiones[0]?.method).toBe('GET');
  });

  it('injerta la respuesta en el nodo del compromiso y el camino llega al bloque', async () => {
    const fake = new FakeOtsCalendar({ uri: 'https://alice.invalid' });
    const fileDigest = await sha256(CHECKPOINT);
    const sello = await fake.stamp(fileDigest);
    const compromiso = pendingCommitments((await parseDetachedTimestamp(sello)).timestamp)[0]!;

    // Lo que devuelve un calendario maduro: el camino desde ESE compromiso hasta un bloque.
    const hermano = new Uint8Array(32).fill(0x11);
    const unidos = new Uint8Array(64);
    unidos.set(hermano, 0);
    unidos.set(compromiso, 32);
    const raiz = await sha256(await sha256(unidos));

    const rama: OtsTimestamp = {
      msg: compromiso,
      attestations: [],
      ops: [
        {
          op: { kind: 'prepend', argument: hermano },
          timestamp: {
            msg: unidos,
            attestations: [],
            ops: [
              {
                op: { kind: 'sha256' },
                timestamp: {
                  msg: await sha256(unidos),
                  attestations: [],
                  ops: [
                    {
                      op: { kind: 'sha256' },
                      timestamp: {
                        msg: raiz,
                        attestations: [{ kind: 'bitcoin', height: 921_447 }],
                        ops: [],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    };

    const suelto = timestampSuelto(
      serializeDetachedTimestamp({
        majorVersion: 1,
        fileHashOp: { kind: 'sha256' },
        fileDigest: compromiso,
        timestamp: rama,
      }),
    );

    const { fetchImpl } = fetchGuionizado(() => respuesta(suelto));
    const maduro = await httpCalendar('https://alice.invalid', fetchImpl).upgrade(sello);
    expect(maduro).toBeDefined();

    // El injerto quedó donde tenía que quedar: el camino recorrido desde el digest del fichero llega
    // a la raíz de Merkle del bloque.
    const detached = await parseDetachedTimestamp(maduro!);
    const hoja = walk(detached.timestamp).find((h) => h.attestation.kind === 'bitcoin');
    expect(hoja).toBeDefined();
    let acumulado = detached.fileDigest;
    for (const op of hoja!.path) acumulado = await applyOp(op, acumulado);
    expect(toHex(acumulado)).toBe(toHex(raiz));

    // Y el proveedor lo da por confirmado con la cabecera delante, y sólo con ella.
    const cabecera = cabeceraCon(raiz, 1_787_000_000);
    expect(toHex(merkleRootOf(cabecera))).toBe(toHex(raiz));
    const proveedor = new OpenTimestampsProvider({
      headers: staticHeaders([[921_447, cabecera]]),
      clock: () => AHORA,
    });
    const resultado = await proveedor.verify(
      {
        provider: 'ots',
        independenceClass: 'blockchain',
        checkpointHash: toHex(CHECKPOINT),
        externalRef: 'bitcoin:921447',
        submittedAt: AHORA,
        proof: Buffer.from(maduro!).toString('base64url'),
        raw: {},
      },
      CHECKPOINT,
    );
    expect(resultado.status).toBe('confirmado');
  });

  it('con varios compromisos pendientes se pide UNO POR CADA UNO', async () => {
    const a = new FakeOtsCalendar({ uri: 'https://alice.invalid', nonceLabel: 'a' });
    const b = new FakeOtsCalendar({ uri: 'https://bob.invalid', nonceLabel: 'b' });
    const fusionado = await calendarPool([a, b]).stamp(await sha256(CHECKPOINT));
    const compromisos = pendingCommitments((await parseDetachedTimestamp(fusionado)).timestamp);
    expect(compromisos).toHaveLength(2);

    const { fetchImpl, peticiones } = fetchGuionizado(() => respuesta(new Uint8Array(0), 404));
    await httpCalendar('https://alice.invalid', fetchImpl).upgrade(fusionado);

    expect(peticiones.map((p) => p.url)).toStrictEqual(
      compromisos.map((c) => `https://alice.invalid/timestamp/${toHex(c)}`),
    );
  });
});

describe('clasificación de errores HTTP', () => {
  it('5xx, 408 y 429 se reintentan; el resto de 4xx no', () => {
    expect(esReintentable(new HttpError('u', 503, 'x'))).toBe(true);
    expect(esReintentable(new HttpError('u', 429, 'x'))).toBe(true);
    expect(esReintentable(new HttpError('u', 408, 'x'))).toBe(true);
    expect(esReintentable(new HttpError('u', 400, 'x'))).toBe(false);
    expect(esReintentable(new HttpError('u', 404, 'x'))).toBe(false);
    // Un fallo de red no trae código: se reintenta, que es lo conservador.
    expect(esReintentable(new Error('ECONNRESET'))).toBe(true);
  });
});

describe('nodeFetch', () => {
  it('pone el agente y las cabeceras fijas, y devuelve una COPIA del cuerpo', async () => {
    let visto: Record<string, string> | undefined;
    const fetchImpl = ((_url: string, init: { headers: Record<string, string> }) => {
      visto = init.headers;
      return Promise.resolve(new Response('hola', { status: 200 }));
    }) as unknown as typeof globalThis.fetch;

    const traer = nodeFetch({ fetchImpl, headers: { 'X-Prueba': '1' } });
    const r = await traer('https://ejemplo.invalid');
    expect(r.ok).toBe(true);
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe('hola');
    expect(visto?.['User-Agent']).toMatch(/^koinonia-anclaje/u);
    expect(visto?.['X-Prueba']).toBe('1');
  });

  it('un cuerpo mayor que el máximo se rechaza en vez de agotar la memoria', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response('x'.repeat(100), { status: 200 }))) as unknown as typeof fetch;
    await expect(nodeFetch({ fetchImpl, maxBodyBytes: 10 })('https://x.invalid')).rejects.toThrow(
      /el cuerpo mide 100 B y el máximo es 10/u,
    );
  });
});

describe('composición completa: HTTP + reintentos + conjunto', () => {
  it('un calendario que devuelve 503 dos veces acaba sellando, y el otro no se entera', async () => {
    const fake = new FakeOtsCalendar({ uri: 'https://alice.invalid' });
    const fileDigest = await sha256(CHECKPOINT);
    const suelto = timestampSuelto(await fake.stamp(fileDigest));

    let fallosDeAlice = 2;
    const { fetchImpl, peticiones } = fetchGuionizado((peticion) => {
      if (peticion.url.startsWith('https://alice.invalid') && fallosDeAlice-- > 0) {
        return respuesta(new Uint8Array(0), 503);
      }
      if (peticion.url.startsWith('https://bob.invalid')) return respuesta(new Uint8Array(0), 500);
      return respuesta(suelto);
    });

    const calendario = retryingCalendar(httpCalendar('https://alice.invalid', fetchImpl), {
      policy: { ...DEFAULT_BACKOFF, attempts: 4 },
      clock: immediateClock(),
      retryable: esReintentable,
    });
    const pool = calendarPool([
      calendario,
      retryingCalendar(httpCalendar('https://bob.invalid', fetchImpl), {
        policy: { ...DEFAULT_BACKOFF, attempts: 2 },
        clock: immediateClock(),
        retryable: esReintentable,
      }),
    ]);

    const bytes = await pool.stamp(fileDigest);
    expect(walk((await parseDetachedTimestamp(bytes)).timestamp)).toHaveLength(1);
    // 3 intentos contra alice (dos 503 y el bueno) y 2 contra bob (dos 500).
    expect(peticiones.filter((p) => p.url.startsWith('https://alice'))).toHaveLength(3);
    expect(peticiones.filter((p) => p.url.startsWith('https://bob'))).toHaveLength(2);
  });

  it('`calendariosDeProduccion` nombra los cuatro calendarios y no un agregador de DNS', async () => {
    const fake = new FakeOtsCalendar();
    const fileDigest = await sha256(CHECKPOINT);
    const suelto = timestampSuelto(await fake.stamp(fileDigest));
    const { fetchImpl, peticiones } = fetchGuionizado(() => respuesta(suelto));

    const pool = calendariosDeProduccion({
      http: {
        fetchImpl: ((url: string, init: { body?: Uint8Array }) => {
          void fetchImpl(url, init);
          return Promise.resolve(new Response(Buffer.from(suelto), { status: 200 }));
        }) as unknown as typeof globalThis.fetch,
      },
      clock: immediateClock(),
    });

    await pool.stamp(fileDigest);
    expect(peticiones.map((p) => p.url).sort()).toStrictEqual([
      'https://alice.btc.calendar.opentimestamps.org/digest',
      'https://bob.btc.calendar.opentimestamps.org/digest',
      'https://btc.calendar.catallaxy.com/digest',
      'https://finney.calendar.eternitywall.com/digest',
    ]);
    expect(pool.uri).not.toContain('a.pool.opentimestamps.org');
  });
});
