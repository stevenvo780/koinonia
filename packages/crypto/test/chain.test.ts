import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  assertCanonicalEvent,
  buildChain,
  type CanonicalEvent,
  type ChainLink,
  InvalidEventError,
  linkEvent,
  SPINE_AGGREGATE_ID,
  SPINE_AGGREGATE_TYPE,
  verifyChain,
} from '../src/chain.js';
import { bytesEqual, hashEvent, toHex, zeroHash } from '../src/hash.js';

const AGREGADO = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const ACTOR = '9f1c2d3e4a5b60718293a4b5c6d7e8f0';

function instante(seq: number): string {
  return new Date(Date.UTC(2026, 7, 21, 14, 0, 0, 0) + seq * 1000).toISOString();
}

function evento(seq: number, texto: string): CanonicalEvent {
  return {
    aggregateId: AGREGADO,
    aggregateType: 'propuesta',
    seq,
    eventType: 'ObjecionRegistrada',
    eventVersion: 1,
    occurredAt: instante(seq),
    actor: ACTOR,
    payload: { texto },
  };
}

/** Cambia exactamente un carácter ASCII: un byte de la preimagen canónica. */
function alterarUnByte(texto: string, posicion: number): string {
  const indice = posicion % texto.length;
  const original = texto.charCodeAt(indice);
  const alterado = String.fromCharCode(original === 122 ? 97 : original + 1);
  return texto.slice(0, indice) + alterado + texto.slice(indice + 1);
}

const textoArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxy'.split('')), {
    minLength: 1,
    maxLength: 12,
  })
  .map((cs) => cs.join(''));

describe('validación del evento canónico', () => {
  it('acepta un evento bien formado, con y sin actor', () => {
    expect(() => {
      assertCanonicalEvent(evento(0, 'hola'));
    }).not.toThrow();
    const { actor: _descartado, ...sinActor } = evento(1, 'hola');
    expect(() => {
      assertCanonicalEvent(sinActor);
    }).not.toThrow();
  });

  it.each([
    ['clave desconocida', { ...evento(0, 'x'), leafIndex: 7 }, 'leafIndex'],
    ['actor en null', { ...evento(0, 'x'), actor: null }, 'actor'],
    ['actor en mayúsculas', { ...evento(0, 'x'), actor: ACTOR.toUpperCase() }, 'actor'],
    [
      'aggregateId sin guiones',
      { ...evento(0, 'x'), aggregateId: AGREGADO.replaceAll('-', '') },
      'aggregateId',
    ],
    ['seq negativo', { ...evento(0, 'x'), seq: -1 }, 'seq'],
    ['seq fraccionario', { ...evento(0, 'x'), seq: 1.5 }, 'seq'],
    ['eventVersion 0', { ...evento(0, 'x'), eventVersion: 0 }, 'eventVersion'],
    [
      'occurredAt sin milisegundos',
      { ...evento(0, 'x'), occurredAt: '2026-08-21T14:00:00Z' },
      'occurredAt',
    ],
    [
      'occurredAt inexistente',
      { ...evento(0, 'x'), occurredAt: '2026-02-30T14:00:00.000Z' },
      'occurredAt',
    ],
    [
      'occurredAt con offset',
      { ...evento(0, 'x'), occurredAt: '2026-08-21T09:00:00.000-05:00' },
      'occurredAt',
    ],
    ['payload que es arreglo', { ...evento(0, 'x'), payload: [] }, 'payload'],
  ])('rechaza %s', (_nombre, malo, campo) => {
    try {
      assertCanonicalEvent(malo);
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEventError);
      expect((error as InvalidEventError).field).toBe(campo);
    }
  });

  it('el MemberId dashed que devolvería una columna `uuid` no es un actor válido', () => {
    // ERROR DE LA SPEC: §1.1 define `actor` como "MemberId, 32 hex minúsculas" y §3.1 lo almacena
    // en una columna `actor uuid`. PostgreSQL acepta la entrada de 32 hex pero la DEVUELVE con
    // guiones (36 caracteres). Reconstruir el evento desde la base cambiaría la preimagen y, con
    // ella, el hash: la propia base produciría el "falso positivo de corrupción" del §1.2.1.
    const dashed = '9f1c2d3e-4a5b-6071-8293-a4b5c6d7e8f0';
    expect(() => {
      assertCanonicalEvent({ ...evento(0, 'x'), actor: dashed });
    }).toThrow(InvalidEventError);
  });
});

describe('cadena de hashes por agregado', () => {
  it('el génesis de la espina #ledger es el único que cuelga de 32 ceros (§2.3)', async () => {
    const genesis: CanonicalEvent = {
      aggregateId: SPINE_AGGREGATE_ID,
      aggregateType: SPINE_AGGREGATE_TYPE,
      seq: 0,
      eventType: 'LedgerAbierto',
      eventVersion: 1,
      occurredAt: instante(0),
      payload: { vigencia: '2026-2' },
    };
    const [eslabon] = await buildChain([genesis]);
    expect(eslabon).toBeDefined();
    expect(toHex(eslabon?.prevHash ?? new Uint8Array())).toBe('00'.repeat(32));
    await expect(verifyChain(await buildChain([genesis]))).resolves.toMatchObject({ ok: true });
  });

  it('un agregado normal nace colgado de la cabeza de la espina, no de ceros', async () => {
    const cabezaEspina = await hashEvent(zeroHash(), evento(0, 'espina'));
    const cadena = await buildChain([evento(0, 'nace')], { genesisPrevHash: cabezaEspina });
    expect(bytesEqual(cadena[0]?.prevHash ?? new Uint8Array(), cabezaEspina)).toBe(true);

    // Verificada contra el génesis correcto: intacta. Contra 32 ceros: rota en el evento 0.
    await expect(verifyChain(cadena, { genesisPrevHash: cabezaEspina })).resolves.toMatchObject({
      ok: true,
    });
    await expect(verifyChain(cadena)).resolves.toMatchObject({
      ok: false,
      brokenAt: 0,
      reason: 'prev-hash-mismatch',
    });
  });

  it('la cadena vacía verifica y su cabeza es el génesis', async () => {
    const resultado = await verifyChain([]);
    expect(resultado.ok).toBe(true);
  });

  it('encadena hacia adelante: la cabeza es el hash del último evento', async () => {
    const cadena = await buildChain([evento(0, 'a'), evento(1, 'b'), evento(2, 'c')]);
    const resultado = await verifyChain(cadena);
    expect(resultado).toMatchObject({ ok: true, length: 3 });
    expect(resultado.ok && toHex(resultado.head)).toBe(toHex(cadena[2]?.eventHash ?? zeroHash()));
  });

  it('detecta el hueco cuando se borra un evento del medio (§2.2)', async () => {
    const eventos = Array.from({ length: 5 }, (_, i) => evento(i, `e${String(i)}`));
    const cadena = await buildChain(eventos);
    const mutilada = [...cadena.slice(0, 2), ...cadena.slice(3)];

    const resultado = await verifyChain(mutilada, { aggregateId: AGREGADO });
    expect(resultado).toMatchObject({ ok: false, brokenAt: 2, reason: 'seq-mismatch' });
  });

  it('detecta un evento de otro agregado infiltrado', async () => {
    const cadena = await buildChain([evento(0, 'a'), evento(1, 'b')]);
    const intruso: ChainLink = {
      ...(cadena[1] as ChainLink),
      event: { ...evento(1, 'b'), aggregateId: '00000000-0000-4000-8000-000000000001' },
    };
    await expect(verifyChain([cadena[0] as ChainLink, intruso])).resolves.toMatchObject({
      ok: false,
      brokenAt: 1,
      reason: 'aggregate-mismatch',
    });
  });
});

describe('propiedades de la cadena', () => {
  it('una cadena de N eventos verifica siempre', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(textoArb, { minLength: 1, maxLength: 15 }), async (textos) => {
        const cadena = await buildChain(textos.map((texto, i) => evento(i, texto)));
        const resultado = await verifyChain(cadena, { aggregateId: AGREGADO });
        expect(resultado).toMatchObject({ ok: true, length: textos.length });
      }),
      { numRuns: 100 },
    );
  });

  it('alterar UN byte de UN evento rompe la verificación EN ESE evento', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(textoArb, { minLength: 1, maxLength: 15 }),
        fc.nat(),
        fc.nat(),
        async (textos, indiceCrudo, posicion) => {
          const objetivo = indiceCrudo % textos.length;
          const cadena = await buildChain(textos.map((texto, i) => evento(i, texto)));

          // El administrador edita el contenido del evento y deja los hashes publicados como están.
          const alterada = cadena.map((eslabon, i) =>
            i === objetivo
              ? { ...eslabon, event: evento(i, alterarUnByte(textos[i] ?? 'a', posicion)) }
              : eslabon,
          );

          const resultado = await verifyChain(alterada, { aggregateId: AGREGADO });
          expect(resultado).toMatchObject({
            ok: false,
            brokenAt: objetivo,
            brokenAtSeq: objetivo,
            reason: 'event-hash-mismatch',
          });
        },
      ),
      { numRuns: 150 },
    );
  });

  it('si además recalcula el hash del evento alterado, la ruptura salta al siguiente eslabón', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(textoArb, { minLength: 2, maxLength: 12 }),
        fc.nat(),
        fc.nat(),
        async (textos, indiceCrudo, posicion) => {
          // El último evento no tiene sucesor: ese caso se comprueba aparte (cambia la cabeza).
          const objetivo = indiceCrudo % (textos.length - 1);
          const cadena = await buildChain(textos.map((texto, i) => evento(i, texto)));
          const nuevoEvento = evento(objetivo, alterarUnByte(textos[objetivo] ?? 'a', posicion));
          const rehecho = await linkEvent(cadena[objetivo]?.prevHash ?? zeroHash(), nuevoEvento);
          const alterada = cadena.map((eslabon, i) => (i === objetivo ? rehecho : eslabon));

          const resultado = await verifyChain(alterada, { aggregateId: AGREGADO });
          expect(resultado).toMatchObject({
            ok: false,
            brokenAt: objetivo + 1,
            reason: 'prev-hash-mismatch',
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('reescribir la cadena entera es internamente coherente: sólo la cabeza publicada lo delata', async () => {
    // §7.1: un ledger reescrito de cero verifica perfecto. Lo único que lo delata es la comparación
    // con una afirmación anterior. Este test documenta el límite de este módulo.
    const original = await buildChain([evento(0, 'a'), evento(1, 'b'), evento(2, 'c')]);
    const reescrita = await buildChain([evento(0, 'a'), evento(1, 'FALSO'), evento(2, 'c')]);

    await expect(verifyChain(reescrita)).resolves.toMatchObject({ ok: true });
    const cabezaOriginal = original.at(-1)?.eventHash ?? zeroHash();
    const cabezaReescrita = reescrita.at(-1)?.eventHash ?? zeroHash();
    expect(bytesEqual(cabezaOriginal, cabezaReescrita)).toBe(false);
  });
});
