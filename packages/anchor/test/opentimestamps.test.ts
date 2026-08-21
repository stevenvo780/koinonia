/**
 * OpenTimestamps: formato real, verificación offline y recibos manipulados.
 *
 * Lo que estas pruebas defienden es la afirmación más fuerte del paquete: que la verificación de un
 * sello **no necesita red** y que, cuando algo no se puede cerrar sin un dato externo, el
 * verificador lo dice en vez de darlo por bueno.
 */

import {
  applyOp,
  FakeOtsCalendar,
  merkleRootOf,
  NO_HEADERS,
  OpenTimestampsProvider,
  OTS_HEADER_MAGIC,
  parseDetachedTimestamp,
  serializeDetachedTimestamp,
  staticHeaders,
  walk,
} from '@koinonia/anchor';
import { fromBase64Url, sha256, toBase64Url, toHex } from '@koinonia/crypto';
import { describe, expect, it } from 'vitest';

import { relojFijo, T_AHORA } from './testigos.js';

const CHECKPOINT = new Uint8Array(32).fill(0xa7);
const OTRO_CHECKPOINT = new Uint8Array(32).fill(0xb3);

function proveedor(headers = NO_HEADERS, calendario = new FakeOtsCalendar()) {
  return {
    provider: new OpenTimestampsProvider({
      calendar: calendario,
      headers,
      clock: relojFijo(T_AHORA),
    }),
    calendario,
  };
}

describe('formato .ots', () => {
  it('la cabecera mágica es la de OpenTimestamps, byte a byte', async () => {
    const { calendario } = proveedor();
    const bytes = await calendario.stamp(await sha256(CHECKPOINT));
    expect([...bytes.slice(0, OTS_HEADER_MAGIC.length)]).toStrictEqual([...OTS_HEADER_MAGIC]);
    // 31 bytes: `\x00OpenTimestamps\x00\x00Proof\x00` + los 8 del identificador.
    expect(OTS_HEADER_MAGIC).toHaveLength(31);
  });

  it('serializar y volver a leer devuelve exactamente los mismos bytes', async () => {
    const { calendario } = proveedor();
    const pendiente = await calendario.stamp(await sha256(CHECKPOINT));
    const maduro = await calendario.upgrade(pendiente);
    for (const bytes of [pendiente, maduro!]) {
      const detached = await parseDetachedTimestamp(bytes);
      expect([...serializeDetachedTimestamp(detached)]).toStrictEqual([...bytes]);
    }
  });

  it('el árbol se recorre y cada hoja llega al digest que le corresponde', async () => {
    const { calendario } = proveedor();
    const digest = await sha256(CHECKPOINT);
    const maduro = (await calendario.upgrade(await calendario.stamp(digest)))!;
    const detached = await parseDetachedTimestamp(maduro);
    const hojas = walk(detached.timestamp);

    expect(hojas).toHaveLength(1);
    const hoja = hojas[0]!;
    expect(hoja.attestation.kind).toBe('bitcoin');

    // Se recorre el camino a mano y tiene que dar el mismo digest.
    let acumulado = detached.fileDigest;
    for (const op of hoja.path) acumulado = await applyOp(op, acumulado);
    expect(toHex(acumulado)).toBe(toHex(hoja.digest));

    const altura = hoja.attestation.kind === 'bitcoin' ? hoja.attestation.height : -1;
    const cabecera = calendario.headers().get(altura)!;
    expect(toHex(merkleRootOf(cabecera))).toBe(toHex(hoja.digest));
  });

  it('un fichero con la cabecera cambiada no se parsea', async () => {
    const { calendario } = proveedor();
    const bytes = await calendario.stamp(await sha256(CHECKPOINT));
    const roto = new Uint8Array(bytes);
    roto[3] = (roto[3]! + 1) & 0xff;
    await expect(parseDetachedTimestamp(roto)).rejects.toThrow(/magic incorrecto/u);
  });

  it('un fichero con bytes de más al final no se parsea: nada de basura tolerada', async () => {
    const { calendario } = proveedor();
    const bytes = await calendario.stamp(await sha256(CHECKPOINT));
    const conCola = new Uint8Array(bytes.length + 3);
    conCola.set(bytes, 0);
    await expect(parseDetachedTimestamp(conCola)).rejects.toThrow(/sobran/u);
  });
});

describe('OpenTimestampsProvider — verificación sin red', () => {
  it('un sello recién enviado queda PENDIENTE, no confirmado', async () => {
    const { provider } = proveedor();
    const recibo = await provider.submit(CHECKPOINT);
    const resultado = await provider.verify(recibo, CHECKPOINT);

    expect(resultado.status).toBe('pendiente');
    expect(resultado.offline).toBe(true);
    expect(recibo.confirmedAt).toBeUndefined();
    expect(resultado.detail).toMatch(/todavía no entró en ningún bloque/u);
  });

  it('sin la cabecera del bloque el resultado es INCOMPLETO y nombra lo que falta', async () => {
    const { provider, calendario } = proveedor();
    const recibo = await provider.submit(CHECKPOINT);
    const maduro = await provider.poll({
      ...recibo,
      proof: toBase64Url((await calendario.upgrade(fromBase64Url(recibo.proof!)))!),
    });

    const sinCabeceras = new OpenTimestampsProvider({
      calendar: calendario,
      headers: NO_HEADERS,
      clock: relojFijo(T_AHORA),
    });
    const resultado = await sinCabeceras.verify(maduro, CHECKPOINT);

    expect(resultado.status).toBe('incompleto');
    expect(resultado.offline).toBe(true);
    expect(resultado.residualClaims).toHaveLength(1);
    expect(resultado.residualClaims[0]!.claim).toMatch(/raíz de Merkle del bloque/u);
    expect(resultado.residualClaims[0]!.verifyBy).toMatch(/explorador/u);
  });

  it('con la cabecera del bloque queda CONFIRMADO, y la fecha sale del bloque', async () => {
    const calendario = new FakeOtsCalendar({ firstHeight: 921_447, firstBlockTime: 1_787_000_040 });
    const emisor = new OpenTimestampsProvider({ calendar: calendario, clock: relojFijo(T_AHORA) });
    const pendiente = await emisor.submit(CHECKPOINT);
    const maduro = await emisor.poll(pendiente);

    const verificador = new OpenTimestampsProvider({
      calendar: calendario,
      headers: calendario.headerSource(),
      clock: relojFijo(T_AHORA),
    });
    const resultado = await verificador.verify(maduro, CHECKPOINT);

    expect(resultado.status).toBe('confirmado');
    expect(resultado.offline).toBe(true);
    expect(resultado.attestedAt).toBe(new Date(1_787_000_040 * 1000).toISOString());
    expect(resultado.checks.find((c) => c.name === 'bloque')?.detail).toMatch(/bloque 921447/u);

    // Incluso confirmado, la afirmación que exige salir al mundo queda escrita.
    expect(resultado.residualClaims.some((r) => /es realmente [0-9a-f]{64}/u.test(r.claim))).toBe(
      true,
    );
  });

  it('un sello de OTRO checkpoint no cuela aunque sea perfectamente válido', async () => {
    const calendario = new FakeOtsCalendar();
    const emisor = new OpenTimestampsProvider({ calendar: calendario, clock: relojFijo(T_AHORA) });
    const reciboAjeno = await emisor.poll(await emisor.submit(OTRO_CHECKPOINT));

    const verificador = new OpenTimestampsProvider({
      calendar: calendario,
      headers: calendario.headerSource(),
      clock: relojFijo(T_AHORA),
    });
    const resultado = await verificador.verify(reciboAjeno, CHECKPOINT);

    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/no son el mismo resumen/u);
  });

  it('reetiquetar el recibo con NUESTRO hash tampoco cuela: el sello sigue siendo de otro', async () => {
    const calendario = new FakeOtsCalendar();
    const emisor = new OpenTimestampsProvider({ calendar: calendario, clock: relojFijo(T_AHORA) });
    const ajeno = await emisor.poll(await emisor.submit(OTRO_CHECKPOINT));
    // El atacante cambia sólo la etiqueta y deja el sello intacto.
    const falsificado = { ...ajeno, checkpointHash: toHex(CHECKPOINT) };

    const verificador = new OpenTimestampsProvider({
      calendar: calendario,
      headers: calendario.headerSource(),
      clock: relojFijo(T_AHORA),
    });
    const resultado = await verificador.verify(falsificado, CHECKPOINT);

    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/el sello no es de este checkpoint/u);
  });

  it('un byte cambiado DENTRO del camino del sello es INVÁLIDO', async () => {
    const calendario = new FakeOtsCalendar();
    const provider = new OpenTimestampsProvider({
      calendar: calendario,
      headers: calendario.headerSource(),
      clock: relojFijo(T_AHORA),
    });
    const recibo = await provider.poll(await provider.submit(CHECKPOINT));
    const bytes = fromBase64Url(recibo.proof!);
    // Byte 70: dentro del nonce que el calendario concatena. Cambiarlo cambia todo el camino.
    bytes[70] = (bytes[70]! + 1) & 0xff;

    const resultado = await provider.verify({ ...recibo, proof: toBase64Url(bytes) }, CHECKPOINT);
    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/el sello es falso/u);
  });

  it('cambiar la ALTURA declarada no es «inválido» sino «incompleto», y así hay que decirlo', async () => {
    // Distinción que importa: alterar el camino produce una contradicción demostrable; alterar la
    // altura sólo produce una afirmación sobre un bloque que no tenemos. Devolver `invalido` en el
    // segundo caso sería acusar sin pruebas, y un verificador que acusa sin pruebas se acaba
    // ignorando. La detección real ocurre igual, porque nadie podrá exhibir ese bloque.
    const calendario = new FakeOtsCalendar();
    const provider = new OpenTimestampsProvider({
      calendar: calendario,
      headers: calendario.headerSource(),
      clock: relojFijo(T_AHORA),
    });
    const recibo = await provider.poll(await provider.submit(CHECKPOINT));
    const bytes = fromBase64Url(recibo.proof!);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1]! + 1) & 0xff; // varuint de la altura

    const resultado = await provider.verify({ ...recibo, proof: toBase64Url(bytes) }, CHECKPOINT);
    expect(resultado.status).toBe('incompleto');
    expect(resultado.residualClaims[0]!.claim).toMatch(/raíz de Merkle del bloque/u);
  });

  it('si la cabecera del bloque desmiente al sello, es INVÁLIDO y no «incompleto»', async () => {
    const calendario = new FakeOtsCalendar({ firstHeight: 700_000 });
    const emisor = new OpenTimestampsProvider({ calendar: calendario, clock: relojFijo(T_AHORA) });
    const recibo = await emisor.poll(await emisor.submit(CHECKPOINT));

    const cabeceraMentirosa = new Uint8Array(calendario.headers().get(700_000)!);
    cabeceraMentirosa[40] = (cabeceraMentirosa[40]! + 1) & 0xff; // toca la raíz de Merkle

    const verificador = new OpenTimestampsProvider({
      calendar: calendario,
      headers: staticHeaders([[700_000, cabeceraMentirosa]]),
      clock: relojFijo(T_AHORA),
    });
    const resultado = await verificador.verify(recibo, CHECKPOINT);

    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/el sello es falso/u);
  });

  it('un recibo que miente sobre la fecha se detecta contra la cabecera del bloque', async () => {
    const calendario = new FakeOtsCalendar();
    const provider = new OpenTimestampsProvider({
      calendar: calendario,
      headers: calendario.headerSource(),
      clock: relojFijo(T_AHORA),
    });
    const recibo = await provider.poll(await provider.submit(CHECKPOINT));

    const resultado = await provider.verify(
      { ...recibo, confirmedAt: '2020-01-01T00:00:00.000Z' },
      CHECKPOINT,
    );
    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/miente sobre cuándo se ancló/u);
  });

  it('un recibo sin sello no prueba nada, por mucho que se declare confirmado', async () => {
    const { provider } = proveedor();
    const recibo = await provider.submit(CHECKPOINT);
    const { proof: _proof, ...sinSello } = recibo;
    const resultado = await provider.verify({ ...sinSello, confirmedAt: T_AHORA }, CHECKPOINT);
    expect(resultado.status).toBe('invalido');
    expect(resultado.detail).toMatch(/no trae el sello/u);
  });

  it('los metadatos declaran que este anclaje no tiene clave que robar', () => {
    const { provider } = proveedor();
    expect(provider.meta.independenceClass).toBe('blockchain');
    expect(provider.meta.signingKeyOffHost).toBe(true);
    expect(provider.meta.verificationNeedsNetwork).toBe(true);
  });
});
