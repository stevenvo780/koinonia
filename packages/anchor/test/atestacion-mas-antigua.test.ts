import { describe, expect, it } from 'vitest';

import { fromBase64Url, sha256, toBase64Url, toHex } from '@koinonia/crypto';

import {
  blockInstant,
  calendarPool,
  FakeOtsCalendar,
  mergeOtsFiles,
  OpenTimestampsProvider,
  parseDetachedTimestamp,
  staticHeaders,
  walk,
  type AnchorReceipt,
} from '../src/index.js';

/**
 * Qué fecha anuncia un anclaje cuando el sello tiene varias, que es el caso normal.
 *
 * ═══ Qué se rompía ═══
 *
 * Un sello de OpenTimestamps no trae una atestación de Bitcoin: trae varias —varios calendarios,
 * más lo que se agrega al madurar—. Los recibos reales de producción traían **cuatro**; por
 * ejemplo `[963933, 963933, 963984, 963989]`.
 *
 * No había una regla para elegir cuál es «la fecha del anclaje», y los dos sitios que la elegían
 * elegían distinto: al crear el recibo se tomaba la **primera** del recorrido, y al verificar se
 * sobrescribía la fecha con **cada** atestación, así que quedaba la **última**. Como casi siempre
 * difieren, la comparación entre las dos fallaba y el verificador acusaba al recibo de mentir
 * sobre cuándo se ancló.
 *
 * Medido en producción el 2026-08-25: **20 de 24 checkpoints rechazados**, todos con ese motivo, y
 * los rechazos de dos checkpoints distintos citando la MISMA hora — la del último bloque, que los
 * dos sellos compartían. No fallaba Bitcoin ni fallaba el envío: se rechazaba solo.
 *
 * ═══ Por qué la más antigua ═══
 *
 * Porque es la afirmación más fuerte que el sello sostiene: «esto ya existía antes del bloque N».
 * Cualquier bloque posterior también es cierto y dice menos, y la fecha de un anclaje es lo último
 * que conviene debilitar.
 *
 * Comprobado rompiéndolo: volviendo `atestacionMasAntigua` a `leaves.find(...)`, o quitando la
 * comparación de altura del bucle de `verify`, los dos primeros casos se ponen en rojo.
 */

const RESUMEN = new Uint8Array(32).fill(0x5c);
const RELOJ = (): string => '2026-08-25T12:00:00.000Z';

/** Dos calendarios que agregan distinto y confirman en bloques distintos, como los de verdad. */
async function selloConDosAtestaciones(): Promise<{
  readonly bytes: Uint8Array;
  readonly cabeceras: ReadonlyMap<number, Uint8Array>;
  readonly alturas: readonly number[];
}> {
  const temprano = new FakeOtsCalendar({
    uri: 'https://calendario-temprano.invalid',
    nonceLabel: 'temprano',
    firstHeight: 800_100,
    firstBlockTime: 1_787_000_000,
  });
  const tardio = new FakeOtsCalendar({
    uri: 'https://calendario-tardio.invalid',
    nonceLabel: 'tardio',
    firstHeight: 800_900,
    firstBlockTime: 1_787_500_000,
  });

  const resumen = await sha256(RESUMEN);
  const sellos: Uint8Array[] = [];
  for (const calendario of [temprano, tardio]) {
    const pendiente = await calendario.stamp(resumen);
    const maduro = await calendario.upgrade(pendiente);
    expect(maduro, 'el calendario de prueba tenía que madurar el sello').toBeDefined();
    if (maduro !== undefined) sellos.push(maduro);
  }
  const bytes = await mergeOtsFiles(sellos);

  const cabeceras = new Map<number, Uint8Array>();
  for (const calendario of [temprano, tardio]) {
    for (const [altura, cabecera] of calendario.headers()) cabeceras.set(altura, cabecera);
  }

  const hojas = walk((await parseDetachedTimestamp(bytes)).timestamp);
  const alturas = hojas
    .map((hoja) => (hoja.attestation.kind === 'bitcoin' ? hoja.attestation.height : undefined))
    .filter((altura): altura is number => altura !== undefined);

  return { bytes, cabeceras, alturas };
}

describe('un sello con varias atestaciones de Bitcoin', () => {
  it('el escenario es el de verdad: hay más de una, y en bloques distintos', async () => {
    const { alturas } = await selloConDosAtestaciones();
    // Si esto deja de cumplirse, los dos casos de abajo no estarían probando lo que dicen probar.
    expect(alturas.length).toBeGreaterThan(1);
    expect(new Set(alturas).size).toBeGreaterThan(1);
  });

  it('la fecha que se da por buena es la del bloque MÁS ANTIGUO', async () => {
    const { bytes, cabeceras, alturas } = await selloConDosAtestaciones();
    const masAntigua = Math.min(...alturas);
    const masReciente = Math.max(...alturas);
    const cabeceraAntigua = cabeceras.get(masAntigua);
    expect(cabeceraAntigua).toBeDefined();
    if (cabeceraAntigua === undefined) return;

    const proveedor = new OpenTimestampsProvider({
      headers: staticHeaders(cabeceras),
      clock: RELOJ,
    });
    const recibo: AnchorReceipt = {
      provider: 'ots',
      independenceClass: 'blockchain',
      checkpointHash: toHex(RESUMEN),
      externalRef: `bitcoin:${String(masAntigua)}`,
      submittedAt: '2026-08-25T00:00:00.000Z',
      confirmedAt: blockInstant(cabeceraAntigua),
      proof: toBase64Url(bytes),
      raw: {},
    };

    const desenlace = await proveedor.verify(recibo, RESUMEN);
    expect(desenlace.status).toBe('confirmado');
    expect(desenlace.attestedAt).toBe(blockInstant(cabeceraAntigua));
    // Y explícitamente NO la del bloque posterior, que es la que quedaba antes del arreglo.
    const cabeceraReciente = cabeceras.get(masReciente);
    if (cabeceraReciente !== undefined) {
      expect(desenlace.attestedAt).not.toBe(blockInstant(cabeceraReciente));
    }
  });

  it('un recibo que declara otra fecha SIGUE siendo rechazado', async () => {
    // La mitad que no se puede perder al arreglar lo otro: la comprobación existe para atrapar un
    // recibo que miente, y ablandarla sería cambiar un falso rechazo por un falso «confirmado».
    const { bytes, cabeceras, alturas } = await selloConDosAtestaciones();
    const cabeceraReciente = cabeceras.get(Math.max(...alturas));
    expect(cabeceraReciente).toBeDefined();
    if (cabeceraReciente === undefined) return;

    const proveedor = new OpenTimestampsProvider({
      headers: staticHeaders(cabeceras),
      clock: RELOJ,
    });
    const desenlace = await proveedor.verify(
      {
        provider: 'ots',
        independenceClass: 'blockchain',
        checkpointHash: toHex(RESUMEN),
        externalRef: `bitcoin:${String(Math.min(...alturas))}`,
        submittedAt: '2026-08-25T00:00:00.000Z',
        confirmedAt: blockInstant(cabeceraReciente),
        proof: toBase64Url(bytes),
        raw: {},
      },
      RESUMEN,
    );
    expect(desenlace.status).toBe('invalido');
    expect(desenlace.detail).toMatch(/miente sobre cuándo se ancló/u);
  });

  it('el RECIBO que se emite también declara la del bloque más antiguo, no la primera del recorrido', async () => {
    /*
     * Este caso entra por donde entra en producción —`submit` y `poll` sobre un conjunto de
     * calendarios, que es lo que fusiona las ramas— en vez de fabricar el recibo a mano. Importa
     * porque la mitad del defecto vivía justo ahí: al crear el recibo se tomaba la PRIMERA
     * atestación del recorrido, y el recorrido no ordena por altura.
     *
     * El calendario que confirma más tarde va primero en el conjunto a propósito: así la primera
     * atestación del recorrido NO es la más antigua, que es la única forma de que este caso
     * distinga «la primera» de «la más antigua».
     */
    const tardio = new FakeOtsCalendar({
      uri: 'https://tardio.invalid',
      nonceLabel: 'tardio',
      firstHeight: 800_900,
      firstBlockTime: 1_787_500_000,
    });
    const temprano = new FakeOtsCalendar({
      uri: 'https://temprano.invalid',
      nonceLabel: 'temprano',
      firstHeight: 800_100,
      firstBlockTime: 1_787_000_000,
    });

    // La fuente lee de los calendarios EN EL MOMENTO de preguntar, no de una copia hecha antes:
    // las alturas y sus cabeceras no existen hasta que `poll` madura el sello, que es la misma
    // llamada que después necesita leerlas.
    const cabeceraDe = (altura: number): Uint8Array | undefined =>
      tardio.headers().get(altura) ?? temprano.headers().get(altura);
    const proveedor = new OpenTimestampsProvider({
      calendar: calendarPool([tardio, temprano]),
      headers: { get: cabeceraDe },
      clock: RELOJ,
    });

    const pendiente = await proveedor.submit(RESUMEN);
    const maduro = await proveedor.poll(pendiente);

    // `maduro.proof` es opcional en el tipo del recibo, así que se comprueba en vez de forzarlo:
    // un recibo maduro sin sello sería otro defecto, y conviene que esta prueba lo diga.
    expect(maduro.proof).toBeDefined();
    const sello = maduro.proof ?? '';
    const hojas = walk((await parseDetachedTimestamp(fromBase64Url(sello))).timestamp);
    const alturas = hojas
      .map((hoja) => (hoja.attestation.kind === 'bitcoin' ? hoja.attestation.height : undefined))
      .filter((altura): altura is number => altura !== undefined);
    expect(alturas.length).toBeGreaterThan(1);
    // Lo que hace útil a este caso: la primera del recorrido no es la más antigua.
    expect(alturas[0]).not.toBe(Math.min(...alturas));

    const cabeceraAntigua = cabeceraDe(Math.min(...alturas));
    expect(cabeceraAntigua).toBeDefined();
    if (cabeceraAntigua === undefined) return;
    expect(maduro.confirmedAt).toBe(blockInstant(cabeceraAntigua));

    // Y el recibo así emitido se verifica solo, que es la propiedad que se había perdido.
    expect((await proveedor.verify(maduro, RESUMEN)).status).toBe('confirmado');
  });
});
