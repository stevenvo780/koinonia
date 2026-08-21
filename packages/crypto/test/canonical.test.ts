import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  canonicalize,
  canonicalizeToBytes,
  CanonicalizationError,
  isCanonical,
  isNfc,
  LEDGER_PROFILE,
  parseCanonical,
  RFC8785_PROFILE,
  toLedgerText,
  toNfc,
} from '../src/canonical.js';
import { sha256, toHex } from '../src/hash.js';

function codigoDeError(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof CanonicalizationError) return error.code;
    throw error;
  }
  throw new Error('se esperaba una CanonicalizationError y no se lanzó ninguna');
}

describe('vectores RFC 8785', () => {
  // VERIFICAR: contrastar con los vectores oficiales de RFC 8785 (Appendix B / `json-canon`).
  // El valor esperado está derivado de las reglas del propio RFC —orden por unidades de código
  // UTF-16 y escapado de `JSON.stringify` de ECMAScript—, no copiado de memoria; aun así debe
  // cotejarse contra el fichero de vectores oficial antes de congelar el módulo.
  it('ordena las claves por unidades de código UTF-16, no por bytes UTF-8', () => {
    const entrada: unknown = JSON.parse(
      String.raw`{
        "\u20ac": "Euro Sign",
        "\r": "Carriage Return",
        "\u000a": "Newline",
        "1": "One",
        "\u0080": "Control\u007f",
        "\ud83d\ude02": "Smiley",
        "\u00f6": "Latin Small Letter O With Diaeresis",
        "\ufb33": "Hebrew Letter Dalet With Dagesh",
        "</script>": "Browser Challenge"
      }`,
    );

    const esperado =
      String.raw`{"\n":"Newline","\r":"Carriage Return","1":"One","</script>":"Browser Challenge",` +
      `"\u0080":"Control\u007f",` +
      `"\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign",` +
      `"\ud83d\ude02":"Smiley","\ufb33":"Hebrew Letter Dalet With Dagesh"}`;

    expect(canonicalize(entrada, RFC8785_PROFILE)).toBe(esperado);

    // El emoji (U+1F602) va DESPUÉS de U+FB33 en orden de puntos de código, pero en UTF-16 su
    // primer sustituto es U+D83D, que va ANTES de U+FB33. Una implementación en Go o Rust que
    // ordenara por bytes UTF-8 los pondría al revés y produciría otro hash: es exactamente la
    // trampa que anuncia §1.3.c.
    const claves = Object.keys(JSON.parse(canonicalize(entrada, RFC8785_PROFILE)) as object);
    expect(claves.at(-2)).toBe('\u{1f602}');
    expect(claves.at(-1)).toBe('\ufb33');
    expect('\u{1f602}' < '\ufb33').toBe(true); // orden UTF-16 (el que manda JCS)
    expect(Buffer.compare(Buffer.from('\u{1f602}'), Buffer.from('\ufb33'))).toBe(1); // UTF-8: al revés
  });

  // VERIFICAR: contrastar con los vectores oficiales de RFC 8785 (§3.2.2.3, "numbers").
  it('serializa los números como Number::toString de ECMAScript', () => {
    const casos: ReadonlyArray<readonly [number, string]> = [
      // El literal del RFC pierde precisión al parsearse, y ESA es la cuestión: el número que
      // realmente existe en memoria es 333333333.3333333, y es el que hay que serializar.
      // eslint-disable-next-line no-loss-of-precision -- vector textual de RFC 8785
      [333333333.33333329, '333333333.3333333'],
      [1e30, '1e+30'],
      [4.5, '4.5'],
      [2e-3, '0.002'],
      [1e-27, '1e-27'],
      [0, '0'],
      [-0, '0'],
      [1e21, '1e+21'],
      [9007199254740991, '9007199254740991'],
    ];
    for (const [valor, texto] of casos) {
      expect(canonicalize(valor, RFC8785_PROFILE)).toBe(texto);
    }
  });

  // VERIFICAR: contrastar con los vectores oficiales de RFC 8785 (§3.2.2.2, "string").
  it('escapa las cadenas como JSON.stringify de ECMAScript', () => {
    const entrada: unknown = JSON.parse(
      String.raw`"\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/"`,
    );
    expect(canonicalize(entrada, RFC8785_PROFILE)).toBe(String.raw`"€$\u000f\nA'B\"\\\\\"/"`);
  });

  it('el vector completo del RFC es RECHAZADO por el perfil del ledger', () => {
    // Contiene `null` y flotantes: legal en RFC 8785, prohibido por el ADR-126. Que el perfil
    // estricto lo rechace es exactamente el comportamiento que se quiere.
    const entrada: unknown = JSON.parse(
      String.raw`{"literals":[null,true,false],"numbers":[333333333.33333329,1E30,4.50,2e-3]}`,
    );
    // Se recorre en orden canónico, así que la primera infracción es `literals[0]`.
    expect(codigoDeError(() => canonicalize(entrada, LEDGER_PROFILE))).toBe('NULL_FORBIDDEN');
    expect(codigoDeError(() => canonicalize({ numbers: [1e30] }, LEDGER_PROFILE))).toBe(
      'UNSAFE_INTEGER',
    );
    expect(codigoDeError(() => canonicalize({ numbers: [4.5] }, LEDGER_PROFILE))).toBe(
      'FRACTIONAL_NUMBER',
    );
  });
});

describe('forma canónica', () => {
  it('no emite espacios en blanco', () => {
    expect(canonicalize({ b: 2, a: [1, 2] })).toBe('{"a":[1,2],"b":2}');
  });

  it('la salida es UTF-8 sin BOM', () => {
    const bytes = canonicalizeToBytes({ texto: 'ñ€' });
    expect(bytes[0]).toBe(0x7b); // '{'
    expect([...bytes.slice(0, 3)]).not.toStrictEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe('{"texto":"ñ€"}');
  });

  it('parseCanonical rechaza todo lo que no sea la forma canónica exacta', () => {
    expect(parseCanonical('{"a":1,"b":2}')).toStrictEqual({ a: 1, b: 2 });
    expect(isCanonical('{"a":1,"b":2}')).toBe(true);
    expect(isCanonical('{"b":2,"a":1}')).toBe(false); // orden
    expect(isCanonical('{"a": 1,"b":2}')).toBe(false); // espacio
    // Claves duplicadas (§1.2.3): el parser se queda con la última, y el texto deja de ser canónico.
    expect(isCanonical('{"voto":"si","voto":"no"}')).toBe(false);
  });
});

describe('rechazos del perfil del ledger', () => {
  it.each([
    ['flotante', { x: 0.1 + 0.2 }, 'FRACTIONAL_NUMBER'],
    ['entero fuera del rango seguro', { x: 2 ** 53 }, 'UNSAFE_INTEGER'],
    ['NaN', { x: Number.NaN }, 'NOT_FINITE'],
    ['Infinity', { x: Number.POSITIVE_INFINITY }, 'NOT_FINITE'],
    ['-Infinity', { x: Number.NEGATIVE_INFINITY }, 'NOT_FINITE'],
    ['-0', { x: -0 }, 'NEGATIVE_ZERO'],
    ['null', { x: null }, 'NULL_FORBIDDEN'],
    ['undefined explícito', { x: undefined }, 'UNDEFINED_FORBIDDEN'],
    ['bigint', { x: 1n }, 'UNSUPPORTED_TYPE'],
    ['clave que empieza por dígito', { '1x': 1 }, 'KEY_PATTERN'],
    ['clave con guion', { 'a-b': 1 }, 'KEY_PATTERN'],
    ['carácter de control', { x: 'a\u0000b' }, 'CONTROL_CHAR'],
    ['retorno de carro', { x: 'a\rb' }, 'CONTROL_CHAR'],
    ['DEL', { x: 'a\u007fb' }, 'CONTROL_CHAR'],
    ['BOM incrustado', { x: 'a\ufeffb' }, 'BYTE_ORDER_MARK'],
    ['no-carácter U+FDD0', { x: '\ufdd0' }, 'NONCHARACTER'],
    ['no-carácter U+FFFE', { x: '\ufffe' }, 'NONCHARACTER'],
    ['sustituto suelto', { x: '\ud800' }, 'LONE_SURROGATE'],
  ])('rechaza %s', (_nombre, valor, codigo) => {
    expect(codigoDeError(() => canonicalize(valor))).toBe(codigo);
  });

  it('rechaza objetos que no son JSON plano', () => {
    expect(codigoDeError(() => canonicalize({ x: new Date(0) }))).toBe('UNSUPPORTED_TYPE');
    expect(codigoDeError(() => canonicalize({ x: new Map() }))).toBe('UNSUPPORTED_TYPE');
    expect(codigoDeError(() => canonicalize({ x: () => 1 }))).toBe('UNSUPPORTED_TYPE');
    expect(codigoDeError(() => canonicalize({ [Symbol('s')]: 1, a: 1 }))).toBe('SYMBOL_KEY');
  });

  it('rechaza referencias circulares', () => {
    const objeto: Record<string, unknown> = { a: 1 };
    objeto['yo'] = objeto;
    expect(codigoDeError(() => canonicalize(objeto))).toBe('CIRCULAR');
  });

  it('admite tabulador y salto de línea: una propuesta necesita texto multilínea', () => {
    expect(canonicalize({ texto: 'uno\ndos\ttres' })).toBe('{"texto":"uno\\ndos\\ttres"}');
  });

  it('el error dice la ruta exacta del valor ofensivo', () => {
    try {
      canonicalize({ acuerdo: { items: [1, 2, 0.5] } });
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalizationError);
      expect((error as CanonicalizationError).path).toBe('acuerdo.items[2]');
    }
  });
});

describe('NFC', () => {
  const compuesto = 'Jos\u00e9'; // é precompuesto (NFC)
  const descompuesto = 'Jose\u0301'; // e + acento combinante (NFD)

  it('rechaza cadenas que no están en NFC en vez de normalizarlas en silencio', () => {
    expect(compuesto).not.toBe(descompuesto);
    expect(canonicalize({ nombre: compuesto })).toBe('{"nombre":"José"}');
    expect(codigoDeError(() => canonicalize({ nombre: descompuesto }))).toBe('NOT_NFC');
    expect(codigoDeError(() => canonicalize({ [descompuesto]: 1 }))).toBe('KEY_PATTERN');
  });

  it('toNfc normaliza claves y valores en profundidad, y no muta la entrada', () => {
    const entrada = { datos: { [descompuesto]: [descompuesto] } };
    const salida = toNfc(entrada);
    expect(canonicalize(salida, RFC8785_PROFILE)).toBe(`{"datos":{"José":["José"]}}`);
    expect(Object.keys(entrada.datos)[0]).toBe(descompuesto); // la entrada sigue intacta
  });

  it('toLedgerText normaliza también los finales de línea', () => {
    expect(toLedgerText('uno\r\ndos\rtres')).toBe('uno\ndos\ntres');
    expect(isNfc(toLedgerText(descompuesto))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Property-based
// ---------------------------------------------------------------------------------------------

const claveArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...'abcxyzABZ'.split('')),
    fc.array(fc.constantFrom(...'abz09_A'.split('')), { maxLength: 5 }),
  )
  .map(([inicial, resto]) => inicial + resto.join(''));

/** Alfabeto NFC, sin controles prohibidos, sin BOM ni no-caracteres, con pares subrogados válidos. */
const textoArb: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(
      ...[
        'a',
        'B',
        '9',
        ' ',
        '\n',
        '\t',
        'á',
        'é',
        'ñ',
        'ö',
        '€',
        '😂',
        '漢',
        'ю',
        '"',
        '\\',
        '/',
        '<',
      ],
    ),
    { maxLength: 10 },
  )
  .map((partes) => partes.join(''));

const { valorArb } = fc.letrec<{
  valorArb: unknown;
  arregloArb: unknown;
  objetoArb: unknown;
}>((tie) => ({
  valorArb: fc.oneof(
    { maxDepth: 3 },
    fc.boolean(),
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
    textoArb,
    tie('arregloArb'),
    tie('objetoArb'),
  ),
  arregloArb: fc.array(tie('valorArb'), { maxLength: 4 }),
  objetoArb: fc.dictionary(claveArb, tie('valorArb'), { maxKeys: 5 }),
}));

const objetoArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(claveArb, valorArb, {
  minKeys: 1,
  maxKeys: 6,
});

describe('propiedades', () => {
  it('canonicalizar es idempotente: canonical(parse(canonical(x))) === canonical(x)', () => {
    fc.assert(
      fc.property(valorArb, (valor) => {
        const primera = canonicalize(valor);
        const segunda = canonicalize(JSON.parse(primera));
        expect(segunda).toBe(primera);
      }),
      { numRuns: 500 },
    );
  });

  it('la forma canónica se acepta a sí misma como canónica', () => {
    fc.assert(
      fc.property(valorArb, (valor) => {
        expect(isCanonical(canonicalize(valor))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('el orden de las claves no altera la canonicalización ni el hash', async () => {
    await fc.assert(
      fc.asyncProperty(objetoArb, fc.integer(), async (objeto, semilla) => {
        const claves = Object.keys(objeto);
        // Permutación determinista a partir de la semilla: se reconstruye el mismo objeto lógico
        // insertando las claves en otro orden.
        const rotado = claves.map(
          (_, i) =>
            claves[(i + Math.abs(semilla % Math.max(claves.length, 1))) % claves.length] ?? '',
        );
        const otro: Record<string, unknown> = {};
        for (const clave of rotado) otro[clave] = objeto[clave];

        expect(canonicalize(otro)).toBe(canonicalize(objeto));
        expect(toHex(await sha256(canonicalizeToBytes(otro)))).toBe(
          toHex(await sha256(canonicalizeToBytes(objeto))),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('coincide con JSON.stringify de V8 sobre el mismo valor con las claves ya ordenadas', () => {
    // RFC 8785 §3.2.2 define el escapado y la serialización de números **en términos de
    // `JSON.stringify` de ECMAScript**. Comparar contra el motor es, por tanto, contrastar con la
    // definición misma: la parte no compartida con nuestra implementación (escapes, formato de
    // números, pares subrogados) la pone V8.
    const ordenarProfundo = (valor: unknown): unknown => {
      if (Array.isArray(valor)) return (valor as readonly unknown[]).map(ordenarProfundo);
      if (typeof valor === 'object' && valor !== null) {
        const origen = valor as Record<string, unknown>;
        const salida: Record<string, unknown> = {};
        for (const clave of Object.keys(origen).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
          salida[clave] = ordenarProfundo(origen[clave]);
        }
        return salida;
      }
      return valor;
    };

    fc.assert(
      fc.property(valorArb, (valor) => {
        expect(canonicalize(valor, RFC8785_PROFILE)).toBe(JSON.stringify(ordenarProfundo(valor)));
      }),
      { numRuns: 500 },
    );
  });

  it('toLedgerText es idempotente y produce siempre NFC', () => {
    fc.assert(
      fc.property(fc.string(), (texto) => {
        const una = toLedgerText(texto);
        expect(toLedgerText(una)).toBe(una);
        expect(isNfc(una)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
