import { createHash } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { bytesEqual, toHex } from '../src/hash.js';
import {
  consistencyProof,
  emptyRoot,
  inclusionProof,
  largestPowerOfTwoLessThan,
  leafHash,
  merkleRoot,
  MerkleTree,
  nodeHash,
  verifyConsistency,
  verifyInclusion,
} from '../src/merkle.js';

// ---------------------------------------------------------------------------------------------
// Implementación de referencia INDEPENDIENTE (node:crypto, recursión directa sobre RFC 6962).
// No comparte una sola línea con `src/merkle.ts`: si ambas coinciden sobre entradas aleatorias, el
// error tendría que estar en las dos a la vez y de la misma forma.
// ---------------------------------------------------------------------------------------------

function sha(...partes: readonly Uint8Array[]): Uint8Array {
  const h = createHash('sha256');
  for (const p of partes) h.update(p);
  return new Uint8Array(h.digest());
}

function hojaRef(d: Uint8Array): Uint8Array {
  return sha(Uint8Array.of(0x00), d);
}

function nodoRef(l: Uint8Array, r: Uint8Array): Uint8Array {
  return sha(Uint8Array.of(0x01), l, r);
}

function raizRef(entradas: readonly Uint8Array[]): Uint8Array {
  const n = entradas.length;
  if (n === 0) return sha();
  if (n === 1) return hojaRef(entradas[0] as Uint8Array);
  const k = 2 ** Math.floor(Math.log2(n - 1)); // otra formulación de "mayor potencia de 2 < n"
  return nodoRef(raizRef(entradas.slice(0, k)), raizRef(entradas.slice(k)));
}

function entrada(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

/** Devuelve una copia con el byte `posicion` invertido. Siempre cambia: `x ^ 0xff !== x`. */
function alterarByte(bytes: Uint8Array, posicion: number): Uint8Array {
  const copia = new Uint8Array(bytes);
  const indice = posicion % copia.length;
  copia[indice] = (copia[indice] ?? 0) ^ 0xff;
  return copia;
}

const entradaArb = fc.uint8Array({ minLength: 32, maxLength: 32 });
const entradasArb = (min: number, max: number) =>
  fc.array(entradaArb, { minLength: min, maxLength: max });

describe('mayor potencia de dos menor que n', () => {
  it.each([
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 4],
    [8, 4],
    [9, 8],
    [1000, 512],
  ])('n=%i → k=%i', (n, k) => {
    expect(largestPowerOfTwoLessThan(n)).toBe(k);
  });

  it('rechaza n < 2, donde la fórmula de bits de la spec produce basura', () => {
    // La spec calcula `1 << (31 - Math.clz32(n - 1))`: con n = 1 eso es `1 << 31`, negativo.
    expect(1 << (31 - Math.clz32(1 - 1))).toBeLessThan(0);
    expect(() => largestPowerOfTwoLessThan(1)).toThrow(RangeError);
    expect(() => largestPowerOfTwoLessThan(0)).toThrow(RangeError);
  });

  it('coincide con la fórmula de bits de la spec en el rango donde ésta es válida', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 2 ** 30 }), (n) => {
        expect(largestPowerOfTwoLessThan(n)).toBe(1 << (31 - Math.clz32(n - 1)));
      }),
      { numRuns: 500 },
    );
  });
});

describe('raíz de Merkle (RFC 6962)', () => {
  it('el árbol vacío es SHA256("")', async () => {
    expect(toHex(await emptyRoot())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(toHex(await merkleRoot([]))).toBe(toHex(await emptyRoot()));
  });

  it('un árbol de una hoja es SHA256(0x00 ‖ d0)', async () => {
    const d0 = entrada(0xaa);
    expect(toHex(await merkleRoot([d0]))).toBe(toHex(hojaRef(d0)));
    expect(toHex(await leafHash(d0))).toBe(toHex(hojaRef(d0)));
  });

  it('un árbol de dos hojas es SHA256(0x01 ‖ h0 ‖ h1)', async () => {
    const [d0, d1] = [entrada(1), entrada(2)];
    expect(toHex(await merkleRoot([d0, d1]))).toBe(toHex(nodoRef(hojaRef(d0), hojaRef(d1))));
    expect(toHex(await nodeHash(hojaRef(d0), hojaRef(d1)))).toBe(
      toHex(nodoRef(hojaRef(d0), hojaRef(d1))),
    );
  });

  it('con número impar de nodos la cola ASCIENDE, no se duplica (CVE-2012-2459)', async () => {
    const [d0, d1, d2] = [entrada(1), entrada(2), entrada(3)];
    const esperado = nodoRef(nodoRef(hojaRef(d0), hojaRef(d1)), hojaRef(d2));
    expect(toHex(await merkleRoot([d0, d1, d2]))).toBe(toHex(esperado));

    // El fallo de Bitcoin: duplicar la última hoja hacía que dos listas distintas —una con la cola
    // repetida— tuvieran la misma raíz. Aquí no.
    expect(toHex(await merkleRoot([d0, d1, d2]))).not.toBe(
      toHex(await merkleRoot([d0, d1, d2, d2])),
    );
  });

  it('cierra el ataque de segunda preimagen del §6.3', async () => {
    // Sin prefijos de dominio, un árbol de 2 hojas cuyos datos fueran `h0‖h1` y `h2‖h3` tendría la
    // MISMA raíz que el de 4 hojas d0..d3, permitiendo negar dos eventos sin romper SHA-256.
    const d = [entrada(1), entrada(2), entrada(3), entrada(4)] as const;
    const hojas = d.map(hojaRef);
    const raiz4 = await merkleRoot([...d]);

    const falso0 = new Uint8Array(64);
    falso0.set(hojas[0] as Uint8Array, 0);
    falso0.set(hojas[1] as Uint8Array, 32);
    const falso1 = new Uint8Array(64);
    falso1.set(hojas[2] as Uint8Array, 0);
    falso1.set(hojas[3] as Uint8Array, 32);

    const raiz2 = await merkleRoot([falso0, falso1]);
    expect(toHex(raiz2)).not.toBe(toHex(raiz4));
  });

  it('coincide con la implementación de referencia para todo n', async () => {
    await fc.assert(
      fc.asyncProperty(entradasArb(0, 33), async (entradas) => {
        expect(toHex(await merkleRoot(entradas))).toBe(toHex(raizRef(entradas)));
      }),
      { numRuns: 60 },
    );
  });

  it('el orden de las hojas ES la afirmación histórica: permutarlas cambia la raíz', async () => {
    const a = entrada(1);
    const b = entrada(2);
    expect(toHex(await merkleRoot([a, b]))).not.toBe(toHex(await merkleRoot([b, a])));
  });
});

describe('prueba de inclusión', () => {
  it('la longitud de la prueba está acotada por ⌈log2(n)⌉', async () => {
    // El árbol de RFC 6962 no es completo: la rama derecha es más corta cuando `n` no es potencia
    // de dos, así que ⌈log2(n)⌉ es una COTA, no la longitud de toda prueba. Con n = 100 la hoja 0
    // paga 7 hashes y la hoja 99 sólo 4, porque su subárbol (36 hojas → 4 → 2 → 1) es más somero.
    const arbol = await MerkleTree.build(Array.from({ length: 100 }, (_, i) => entrada(i)));
    const cota = Math.ceil(Math.log2(100));
    expect(arbol.inclusionProof(0).length).toBe(cota);
    expect(arbol.inclusionProof(99).length).toBe(4);
    for (let i = 0; i < 100; i++) {
      expect(arbol.inclusionProof(i).length).toBeLessThanOrEqual(cota);
    }
  });

  it('para todo árbol de tamaño N y todo i < N, la prueba verifica contra la raíz', async () => {
    await fc.assert(
      fc.asyncProperty(entradasArb(1, 33), fc.nat(), async (entradas, indiceCrudo) => {
        const indice = indiceCrudo % entradas.length;
        const arbol = await MerkleTree.build(entradas);
        const prueba = arbol.inclusionProof(indice);
        const verifica = await verifyInclusion(
          entradas[indice] as Uint8Array,
          BigInt(indice),
          BigInt(entradas.length),
          prueba,
          arbol.root(),
        );
        expect(verifica).toBe(true);
      }),
      { numRuns: 120 },
    );
  });

  it('una prueba con un hermano alterado NUNCA verifica', async () => {
    await fc.assert(
      fc.asyncProperty(
        entradasArb(2, 33),
        fc.nat(),
        fc.nat(),
        fc.nat({ max: 255 }),
        async (entradas, indiceCrudo, nodoCrudo, byteCrudo) => {
          const indice = indiceCrudo % entradas.length;
          const arbol = await MerkleTree.build(entradas);
          const prueba = arbol.inclusionProof(indice);
          const objetivo = nodoCrudo % prueba.length;
          const alterada = prueba.map((nodo, i) =>
            i === objetivo ? alterarByte(nodo, byteCrudo) : nodo,
          );

          const verifica = await verifyInclusion(
            entradas[indice] as Uint8Array,
            BigInt(indice),
            BigInt(entradas.length),
            alterada,
            arbol.root(),
          );
          expect(verifica).toBe(false);
        },
      ),
      { numRuns: 120 },
    );
  });

  it('rechaza pruebas mal formadas y hojas fuera de rango', async () => {
    const entradas = Array.from({ length: 7 }, (_, i) => entrada(i));
    const arbol = await MerkleTree.build(entradas);
    const raiz = arbol.root();
    const prueba = arbol.inclusionProof(3);
    const hoja = entradas[3] as Uint8Array;

    const casos: ReadonlyArray<readonly [string, Promise<boolean>]> = [
      ['índice fuera del árbol', verifyInclusion(hoja, 7n, 7n, prueba, raiz)],
      ['árbol de tamaño 0', verifyInclusion(hoja, 0n, 0n, [], raiz)],
      ['índice negativo', verifyInclusion(hoja, -1n, 7n, prueba, raiz)],
      ['falta un nodo', verifyInclusion(hoja, 3n, 7n, prueba.slice(0, -1), raiz)],
      ['sobra un nodo', verifyInclusion(hoja, 3n, 7n, [...prueba, entrada(9)], raiz)],
      ['nodo de longitud errónea', verifyInclusion(hoja, 3n, 7n, [new Uint8Array(31)], raiz)],
      ['hoja que no está', verifyInclusion(entrada(200), 3n, 7n, prueba, raiz)],
      ['raíz de otro árbol', verifyInclusion(hoja, 3n, 7n, prueba, entrada(0))],
    ];
    for (const [nombre, resultado] of casos) {
      expect(await resultado, nombre).toBe(false);
    }
  });

  it('una prueba de otra hoja no sirve para la hoja pedida', async () => {
    const entradas = Array.from({ length: 9 }, (_, i) => entrada(i));
    const arbol = await MerkleTree.build(entradas);
    expect(
      await verifyInclusion(
        entradas[2] as Uint8Array,
        2n,
        9n,
        arbol.inclusionProof(5),
        arbol.root(),
      ),
    ).toBe(false);
  });
});

describe('prueba de consistencia', () => {
  it('m = n exige prueba vacía y raíces iguales', async () => {
    const entradas = Array.from({ length: 6 }, (_, i) => entrada(i));
    const raiz = await merkleRoot(entradas);
    expect(await consistencyProof(entradas, 6)).toStrictEqual([]);
    expect(await verifyConsistency(6n, 6n, [], raiz, raiz)).toBe(true);
    expect(await verifyConsistency(6n, 6n, [], raiz, entrada(0))).toBe(false);
    expect(await verifyConsistency(6n, 6n, [raiz], raiz, raiz)).toBe(false);
  });

  it('m = 0: el árbol vacío es prefijo de todo, pero su raíz debe ser SHA256("")', async () => {
    const entradas = Array.from({ length: 5 }, (_, i) => entrada(i));
    const nueva = await merkleRoot(entradas);
    expect(await consistencyProof(entradas, 0)).toStrictEqual([]);
    expect(await verifyConsistency(0n, 5n, [], await emptyRoot(), nueva)).toBe(true);
    expect(await verifyConsistency(0n, 5n, [], entrada(0), nueva)).toBe(false);
  });

  it('m > n nunca verifica', async () => {
    const raiz = await merkleRoot([entrada(1)]);
    expect(await verifyConsistency(5n, 2n, [], raiz, raiz)).toBe(false);
  });

  it('para todos m < n, la prueba entre el árbol de m y el de n verifica', async () => {
    await fc.assert(
      fc.asyncProperty(entradasArb(1, 25), fc.nat(), async (entradas, mCrudo) => {
        const n = entradas.length;
        const m = mCrudo % (n + 1); // incluye m = 0 y m = n
        const viejo = await merkleRoot(entradas.slice(0, m));
        const nuevo = await merkleRoot(entradas);
        const prueba = await consistencyProof(entradas, m);
        expect(await verifyConsistency(BigInt(m), BigInt(n), prueba, viejo, nuevo)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('la longitud de la prueba es O(log n)', async () => {
    const entradas = Array.from({ length: 128 }, (_, i) => entrada(i));
    for (const m of [1, 7, 64, 100, 127]) {
      expect((await consistencyProof(entradas, m)).length).toBeLessThanOrEqual(
        2 * Math.ceil(Math.log2(128)),
      );
    }
  });

  it('ALTERAR UNA HOJA DEL PASADO HACE IMPOSIBLE LA PRUEBA (ataque de reescritura)', async () => {
    // Éste es el test que da sentido a todo el módulo: el servidor reescribe una hoja anterior a m,
    // recompone un árbol internamente perfecto, publica una raíz nueva coherente y genera él mismo
    // la prueba de consistencia. Contra la raíz vieja ya anclada, la prueba no puede existir.
    await fc.assert(
      fc.asyncProperty(
        entradasArb(2, 25),
        fc.nat(),
        fc.nat(),
        fc.nat({ max: 255 }),
        async (entradas, mCrudo, hojaCruda, byteCrudo) => {
          const n = entradas.length;
          const m = 1 + (mCrudo % (n - 1)); // 1 <= m < n
          const objetivo = hojaCruda % m; // una hoja del PASADO
          const raizVieja = await merkleRoot(entradas.slice(0, m));

          const falsificadas = entradas.map((e, i) =>
            i === objetivo ? alterarByte(e, byteCrudo) : e,
          );

          const raizNueva = await merkleRoot(falsificadas);
          const pruebaDelAtacante = await consistencyProof(falsificadas, m);

          expect(
            await verifyConsistency(BigInt(m), BigInt(n), pruebaDelAtacante, raizVieja, raizNueva),
          ).toBe(false);

          // Tampoco le sirve reusar la prueba honesta del árbol original.
          const pruebaHonesta = await consistencyProof(entradas, m);
          expect(
            await verifyConsistency(BigInt(m), BigInt(n), pruebaHonesta, raizVieja, raizNueva),
          ).toBe(false);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('reordenar las primeras m hojas también hace imposible la prueba', async () => {
    const entradas = Array.from({ length: 9 }, (_, i) => entrada(i));
    const m = 5;
    const raizVieja = await merkleRoot(entradas.slice(0, m));
    const permutadas = [entradas[1], entradas[0], ...entradas.slice(2)] as Uint8Array[];
    const raizNueva = await merkleRoot(permutadas);
    const prueba = await consistencyProof(permutadas, m);
    expect(await verifyConsistency(BigInt(m), 9n, prueba, raizVieja, raizNueva)).toBe(false);
  });

  it('una prueba con un nodo alterado nunca verifica', async () => {
    await fc.assert(
      fc.asyncProperty(
        entradasArb(3, 20),
        fc.nat(),
        fc.nat(),
        async (entradas, mCrudo, nodoCrudo) => {
          const n = entradas.length;
          const m = 1 + (mCrudo % (n - 1));
          const prueba = await consistencyProof(entradas, m);
          fc.pre(prueba.length > 0);
          const objetivo = nodoCrudo % prueba.length;
          const alterada = prueba.map((nodo, i) => (i === objetivo ? alterarByte(nodo, 0) : nodo));
          const viejo = await merkleRoot(entradas.slice(0, m));
          const nuevo = await merkleRoot(entradas);
          expect(await verifyConsistency(BigInt(m), BigInt(n), alterada, viejo, nuevo)).toBe(false);
        },
      ),
      { numRuns: 120 },
    );
  });
});

describe('MerkleTree', () => {
  it('las pruebas y la raíz son copias: nadie puede corromper el árbol desde fuera', async () => {
    const arbol = await MerkleTree.build([entrada(1), entrada(2), entrada(3)]);
    const raiz = arbol.root();
    raiz.set(alterarByte(raiz, 0));
    expect(bytesEqual(arbol.root(), raiz)).toBe(false);

    const prueba = arbol.inclusionProof(0);
    (prueba[0] as Uint8Array).set(alterarByte(prueba[0] as Uint8Array, 0));
    expect(bytesEqual(arbol.inclusionProof(0)[0] as Uint8Array, prueba[0] as Uint8Array)).toBe(
      false,
    );
  });

  it('rechaza índices y tamaños imposibles', async () => {
    const arbol = await MerkleTree.build([entrada(1), entrada(2)]);
    expect(() => arbol.inclusionProof(2)).toThrow(RangeError);
    expect(() => arbol.inclusionProof(-1)).toThrow(RangeError);
    expect(() => arbol.inclusionProof(1.5)).toThrow(RangeError);
    expect(() => arbol.consistencyProof(3)).toThrow(RangeError);
    expect(() => arbol.consistencyProof(-1)).toThrow(RangeError);
  });

  it('inclusionProof y consistencyProof sueltos coinciden con los del árbol', async () => {
    const entradas = Array.from({ length: 11 }, (_, i) => entrada(i));
    const arbol = await MerkleTree.build(entradas);
    expect(await inclusionProof(entradas, 4)).toStrictEqual(arbol.inclusionProof(4));
    expect(await consistencyProof(entradas, 4)).toStrictEqual(arbol.consistencyProof(4));
  });
});
