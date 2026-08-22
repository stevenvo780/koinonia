/**
 * Reintentos con retroceso exponencial y **envío a varios calendarios**.
 *
 * Ninguna de estas pruebas sale a la red, y no por comodidad: una suite que dependiera de
 * `a.pool.opentimestamps.org` fallaría los días que ese servicio esté saturado y acabaría
 * desactivada, que es como se pierde la única defensa contra el administrador. Lo que sí se prueba
 * aquí es todo lo que **no** es el diálogo HTTP: la aritmética del retroceso, qué pasa cuando un
 * calendario se cae, qué pasa cuando se caen todos, y que el `.ots` fusionado es un fichero legítimo
 * que el verificador entiende.
 *
 * El tiempo y el azar entran como datos: `sleep` anota lo que se le pidió esperar y vuelve al
 * instante. Por eso estas pruebas tardan milisegundos en vez de medio minuto.
 */

import {
  backoffDelayMs,
  BackoffPolicyError,
  calendarPool,
  CalendarPoolError,
  DEFAULT_BACKOFF,
  FakeOtsCalendar,
  mergeOtsFiles,
  OpenTimestampsProvider,
  parseDetachedTimestamp,
  RetriesExhaustedError,
  retryingCalendar,
  staticHeaders,
  walk,
  withBackoff,
  type BackoffPolicy,
  type BitcoinHeaderSource,
  type OtsCalendarClient,
  type RetryClock,
} from '@koinonia/anchor';
import { sha256, toHex } from '@koinonia/crypto';
import { describe, expect, it } from 'vitest';

import { relojFijo, T_AHORA } from './testigos.js';

const CHECKPOINT = new Uint8Array(32).fill(0x4d);

const SIN_JITTER: BackoffPolicy = {
  attempts: 4,
  baseDelayMs: 100,
  factor: 2,
  maxDelayMs: 10_000,
  jitter: 0,
};

/** Reloj de pruebas: no espera, pero **apunta** cuánto se le pidió esperar. */
function relojDePruebas(azar: readonly number[] = [0]): RetryClock & {
  readonly esperas: readonly number[];
} {
  const esperas: number[] = [];
  let i = 0;
  return {
    esperas,
    sleep: (ms) => {
      esperas.push(ms);
      return Promise.resolve();
    },
    random: () => azar[i++ % azar.length] ?? 0,
  };
}

describe('backoffDelayMs — la aritmética del retroceso', () => {
  it('crece exponencialmente y se detiene en el techo', () => {
    const politica: BackoffPolicy = { ...SIN_JITTER, attempts: 9 };
    const serie = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => backoffDelayMs(n, politica, 0));
    expect(serie).toStrictEqual([100, 200, 400, 800, 1600, 3200, 6400, 10_000]);
  });

  it('con jitter completo el retardo cae en (0, base] y nunca lo supera', () => {
    const politica: BackoffPolicy = { ...SIN_JITTER, jitter: 1 };
    expect(backoffDelayMs(0, politica, 0)).toBe(0);
    expect(backoffDelayMs(0, politica, 0.5)).toBe(50);
    expect(backoffDelayMs(0, politica, 0.999)).toBe(100);
    expect(backoffDelayMs(3, politica, 0.999)).toBeLessThanOrEqual(800);
  });

  it('con jitter parcial el retardo tiene suelo: no se sincronizan pero tampoco vuelven al instante', () => {
    const politica: BackoffPolicy = { ...SIN_JITTER, jitter: 0.5 };
    expect(backoffDelayMs(2, politica, 0)).toBe(200); // 400 · (1 − 0,5)
    expect(backoffDelayMs(2, politica, 0.999)).toBe(400);
  });

  it('rechaza un `random` fuera de [0, 1) en vez de producir un retardo absurdo', () => {
    expect(() => backoffDelayMs(0, DEFAULT_BACKOFF, 1)).toThrow(BackoffPolicyError);
    expect(() => backoffDelayMs(0, DEFAULT_BACKOFF, -0.1)).toThrow(BackoffPolicyError);
    expect(() => backoffDelayMs(-1, DEFAULT_BACKOFF, 0)).toThrow(BackoffPolicyError);
  });

  it('rechaza una política que no retrocede', () => {
    expect(() => backoffDelayMs(0, { ...SIN_JITTER, factor: 0.5 }, 0)).toThrow(
      /factor < 1 haría decrecer/u,
    );
    expect(() => backoffDelayMs(0, { ...SIN_JITTER, attempts: 0 }, 0)).toThrow(/attempts/u);
    expect(() => backoffDelayMs(0, { ...SIN_JITTER, jitter: 2 }, 0)).toThrow(/jitter/u);
  });
});

describe('withBackoff', () => {
  it('a la primera no espera nada y no reporta fallos', async () => {
    const clock = relojDePruebas();
    const { value, failures } = await withBackoff(() => Promise.resolve('listo'), {
      policy: SIN_JITTER,
      clock,
      what: 'sellar',
    });
    expect(value).toBe('listo');
    expect(failures).toStrictEqual([]);
    expect(clock.esperas).toStrictEqual([]);
  });

  it('reintenta con la serie exacta y devuelve los fallos por el camino', async () => {
    const clock = relojDePruebas();
    let intentos = 0;
    const { value, failures } = await withBackoff(
      () => {
        intentos++;
        if (intentos < 3) return Promise.reject(new Error(`503 en el intento ${String(intentos)}`));
        return Promise.resolve(intentos);
      },
      { policy: SIN_JITTER, clock, what: 'sellar' },
    );

    expect(value).toBe(3);
    expect(clock.esperas).toStrictEqual([100, 200]);
    expect(failures.map((f) => f.error)).toStrictEqual([
      '503 en el intento 1',
      '503 en el intento 2',
    ]);
    expect(failures.map((f) => f.waitedMs)).toStrictEqual([100, 200]);
  });

  it('cuando se agotan los intentos lanza y trae lo que dijo CADA uno', async () => {
    const clock = relojDePruebas();
    const error = await withBackoff(() => Promise.reject(new Error('502')), {
      policy: { ...SIN_JITTER, attempts: 3 },
      clock,
      what: 'sellar en https://calendario.invalid',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RetriesExhaustedError);
    const exhausted = error as RetriesExhaustedError;
    expect(exhausted.failures).toHaveLength(3);
    expect(exhausted.message).toMatch(/sellar en https:\/\/calendario\.invalid/u);
    expect(exhausted.message).toMatch(/se agotaron 3 intento\(s\)/u);
    // Se esperó entre intentos, pero NO después del último: esperar para nada alarga la ventana en
    // la que el checkpoint está sin anclar.
    expect(clock.esperas).toStrictEqual([100, 200]);
  });

  it('un error que no es reintentable corta al primer intento y no gasta el presupuesto', async () => {
    const clock = relojDePruebas();
    const error = await withBackoff(() => Promise.reject(new Error('400 digest mal formado')), {
      policy: SIN_JITTER,
      clock,
      what: 'sellar',
      retryable: (e) => !/400/u.test(e instanceof Error ? e.message : ''),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RetriesExhaustedError);
    expect((error as RetriesExhaustedError).failures).toHaveLength(1);
    expect(clock.esperas).toStrictEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Calendarios
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Calendario que falla las primeras `fallos` veces y luego se comporta. */
function intermitente(inner: OtsCalendarClient, fallos: number): OtsCalendarClient {
  let restantes = fallos;
  return {
    uri: inner.uri,
    stamp: (digest) => {
      if (restantes-- > 0) return Promise.reject(new Error('503 Service Unavailable'));
      return inner.stamp(digest);
    },
    upgrade: (bytes) => inner.upgrade(bytes),
  };
}

/** Calendario caído del todo. */
function caido(uri: string): OtsCalendarClient {
  return {
    uri,
    stamp: () => Promise.reject(new Error('ECONNREFUSED')),
    upgrade: () => Promise.reject(new Error('ECONNREFUSED')),
  };
}

/** Calendario que sella pero nunca madura. Es el estado normal las primeras horas. */
function inmaduro(inner: OtsCalendarClient): OtsCalendarClient {
  return {
    uri: inner.uri,
    stamp: (digest) => inner.stamp(digest),
    upgrade: () => Promise.resolve(undefined),
  };
}

function unionDeCabeceras(...fuentes: readonly BitcoinHeaderSource[]): BitcoinHeaderSource {
  return {
    get: (height) => {
      for (const fuente of fuentes) {
        const header = fuente.get(height);
        if (header !== undefined) return header;
      }
      return undefined;
    },
  };
}

describe('retryingCalendar', () => {
  it('un calendario que se cae dos veces acaba sellando', async () => {
    const clock = relojDePruebas();
    const calendario = retryingCalendar(intermitente(new FakeOtsCalendar(), 2), {
      policy: SIN_JITTER,
      clock,
    });

    const bytes = await calendario.stamp(await sha256(CHECKPOINT));
    expect((await parseDetachedTimestamp(bytes)).fileDigest).toHaveLength(32);
    expect(clock.esperas).toStrictEqual([100, 200]);
  });

  it('«todavía no hay bloque» NO es un fallo y no consume reintentos', async () => {
    const clock = relojDePruebas();
    const base = new FakeOtsCalendar();
    const calendario = retryingCalendar(inmaduro(base), { policy: SIN_JITTER, clock });

    const sello = await calendario.stamp(await sha256(CHECKPOINT));
    expect(await calendario.upgrade(sello)).toBeUndefined();
    expect(clock.esperas).toStrictEqual([]);
  });
});

describe('calendarPool — un solo calendario es un punto único de fallo', () => {
  it('sella en los dos y el `.ots` fusionado trae UNA atestación pendiente por calendario', async () => {
    const a = new FakeOtsCalendar({ uri: 'https://alice.invalid', nonceLabel: 'a' });
    const b = new FakeOtsCalendar({ uri: 'https://bob.invalid', nonceLabel: 'b' });
    const pool = calendarPool([a, b]);

    const bytes = await pool.stamp(await sha256(CHECKPOINT));
    const detached = await parseDetachedTimestamp(bytes);
    const pendientes = walk(detached.timestamp).filter((l) => l.attestation.kind === 'pending');

    expect(pendientes).toHaveLength(2);
    expect(
      pendientes.map((l) => (l.attestation.kind === 'pending' ? l.attestation.uri : '')).sort(),
    ).toStrictEqual(['https://alice.invalid', 'https://bob.invalid']);

    // Y sigue siendo un fichero .ots legítimo: se reserializa byte a byte igual.
    const proveedor = new OpenTimestampsProvider({ clock: relojFijo(T_AHORA) });
    const recibo = {
      provider: 'ots',
      independenceClass: 'blockchain' as const,
      checkpointHash: toHex(CHECKPOINT),
      externalRef: 'https://alice.invalid',
      submittedAt: T_AHORA,
      proof: Buffer.from(bytes).toString('base64url'),
      raw: {},
    };
    const resultado = await proveedor.verify(recibo, CHECKPOINT);
    expect(resultado.status).toBe('pendiente');
    expect(resultado.checks.filter((c) => c.name === 'atestacion_pendiente')).toHaveLength(2);
  });

  it('si UN calendario se cae, el anclaje sigue existiendo', async () => {
    const bueno = new FakeOtsCalendar({ uri: 'https://alice.invalid', nonceLabel: 'a' });
    const pool = calendarPool([caido('https://bob.invalid'), bueno]);

    const bytes = await pool.stamp(await sha256(CHECKPOINT));
    const pendientes = walk((await parseDetachedTimestamp(bytes)).timestamp).filter(
      (l) => l.attestation.kind === 'pending',
    );
    expect(pendientes).toHaveLength(1);
  });

  it('si se caen TODOS, falla ruidosamente y dice qué contestó cada uno', async () => {
    const pool = calendarPool([caido('https://alice.invalid'), caido('https://bob.invalid')]);
    const error = await pool.stamp(await sha256(CHECKPOINT)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CalendarPoolError);
    const fallo = error as CalendarPoolError;
    expect(fallo.message).toMatch(/hacían falta 1 calendario\(s\) y sellaron 0 de 2/u);
    expect([...fallo.failures.keys()].sort()).toStrictEqual([
      'https://alice.invalid',
      'https://bob.invalid',
    ]);
  });

  it('exigir dos calendarios y tener uno es un fallo, no un anclaje a medias', async () => {
    const pool = calendarPool([new FakeOtsCalendar(), caido('https://bob.invalid')], {
      minSuccess: 2,
    });
    await expect(pool.stamp(await sha256(CHECKPOINT))).rejects.toThrow(CalendarPoolError);
  });

  it('basta con que UNA rama madure para que el checkpoint quede dentro de Bitcoin', async () => {
    const a = new FakeOtsCalendar({ uri: 'https://alice.invalid', nonceLabel: 'a' });
    const b = new FakeOtsCalendar({ uri: 'https://bob.invalid', nonceLabel: 'b' });
    const pool = calendarPool([a, inmaduro(b)]);

    const proveedor = new OpenTimestampsProvider({
      calendar: pool,
      headers: unionDeCabeceras(a.headerSource(), b.headerSource()),
      clock: relojFijo(T_AHORA),
    });

    const pendiente = await proveedor.submit(CHECKPOINT);
    expect((await proveedor.verify(pendiente, CHECKPOINT)).status).toBe('pendiente');

    const maduro = await proveedor.poll(pendiente);
    const resultado = await proveedor.verify(maduro, CHECKPOINT);

    expect(resultado.status).toBe('confirmado');
    // La rama del calendario que aún no maduró se conserva: es con la que se reintenta mañana.
    expect(
      resultado.checks.filter((c) => c.name === 'atestacion_pendiente').length,
    ).toBeGreaterThan(0);
    expect(resultado.checks.some((c) => c.name === 'bloque' && c.ok)).toBe(true);
  });

  it('si ningún calendario responde al madurar, no se calla: lanza', async () => {
    const a = new FakeOtsCalendar({ uri: 'https://alice.invalid', nonceLabel: 'a' });
    const sello = await a.stamp(await sha256(CHECKPOINT));
    const pool = calendarPool([caido('https://alice.invalid')]);
    await expect(pool.upgrade(sello)).rejects.toThrow(/ningún calendario respondió/u);
  });

  it('si nadie maduró pero alguien contestó, es «todavía no» y no un fallo', async () => {
    const a = new FakeOtsCalendar({ uri: 'https://alice.invalid', nonceLabel: 'a' });
    const pool = calendarPool([inmaduro(a), caido('https://bob.invalid')]);
    const sello = await pool.stamp(await sha256(CHECKPOINT));
    expect(await pool.upgrade(sello)).toBeUndefined();
  });
});

describe('fusión de sellos', () => {
  it('fusionar dos veces el mismo sello no lo duplica', async () => {
    const a = new FakeOtsCalendar({ uri: 'https://alice.invalid', nonceLabel: 'a' });
    const sello = await a.stamp(await sha256(CHECKPOINT));
    const fusionado = await mergeOtsFiles([sello, sello]);
    expect([...fusionado]).toStrictEqual([...sello]);
  });

  it('NO fusiona sellos de digests distintos: sería un fichero que afirma dos cosas', async () => {
    const a = new FakeOtsCalendar({ uri: 'https://alice.invalid', nonceLabel: 'a' });
    const uno = await a.stamp(await sha256(CHECKPOINT));
    const otro = await a.stamp(await sha256(new Uint8Array(32).fill(0x99)));
    await expect(mergeOtsFiles([uno, otro])).rejects.toThrow(/afirmaría dos cosas a la vez/u);
  });

  it('el sello fusionado sigue siendo del checkpoint, y el verificador lo comprueba', async () => {
    const a = new FakeOtsCalendar({ uri: 'https://alice.invalid', nonceLabel: 'a' });
    const b = new FakeOtsCalendar({ uri: 'https://bob.invalid', nonceLabel: 'b' });
    const pool = calendarPool([a, b]);
    const proveedor = new OpenTimestampsProvider({
      calendar: pool,
      headers: staticHeaders([]),
      clock: relojFijo(T_AHORA),
    });

    // Se falsifica el recibo como lo haría un administrador: el campo `checkpointHash` dice el
    // resumen nuevo, pero el `.ots` que trae sigue sellando el viejo. El campo no salva al sello.
    const recibo = await proveedor.submit(CHECKPOINT);
    const otro = new Uint8Array(32).fill(0x11);
    const resultado = await proveedor.verify({ ...recibo, checkpointHash: toHex(otro) }, otro);

    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/el sello no es de este checkpoint/u);
  });

  it('un nodo con atestación Y ramas se vuelve a leer byte a byte igual', async () => {
    // Es el caso que produce madurar un sello: la rama del calendario conserva su atestación
    // pendiente y le cuelga debajo el camino hasta el bloque. Si el serializador no lo escribe bien,
    // el fichero deja de ser legible y el anclaje se pierde sin que nadie lo note hasta meses
    // después, cuando alguien intente verificar.
    const a = new FakeOtsCalendar({ uri: 'https://alice.invalid', nonceLabel: 'a' });
    const pool = calendarPool([a]);
    const pendiente = await pool.stamp(await sha256(CHECKPOINT));
    const maduro = (await pool.upgrade(pendiente))!;

    const detached = await parseDetachedTimestamp(maduro);
    const clases = walk(detached.timestamp)
      .map((l) => l.attestation.kind)
      .sort();
    expect(clases).toStrictEqual(['bitcoin', 'pending']);
    expect([...(await mergeOtsFiles([maduro]))]).toStrictEqual([...maduro]);
  });
});
