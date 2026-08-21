# ADR-0027: Aritmética exacta con enteros y fracciones; prohibido el punto flotante en decisiones de umbral

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `30-decision-engine-spec.md` §0.1 (principio 3), §A.1 (`Fraction`, `cmpFraction`), DECISIÓN B.0.a (pesos enteros) y B.5.c.

## Contexto

`0.1 + 0.2 !== 0.3`. Comparar `0.6666666` contra `2/3` produce resultados que dependen del orden de las operaciones, y por tanto de la implementación. En un escrutinio eso significa que **una supermayoría de 2/3 puede pasar en un verificador y fallar en otro**, con exactamente los mismos votos.

Es el peor tipo de fallo posible aquí: raro, silencioso, imposible de explicar a una asamblea y devastador para la confianza cuando ocurre.

## Decisión

Todas las comparaciones de umbral se hacen con **enteros** o con **fracciones exactas** `{ num: bigint; den: bigint }`, comparadas por multiplicación cruzada:

```ts
export function cmpFraction(a: Fraction, b: Fraction): -1 | 0 | 1 {
  const l = a.num * b.den, r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}
```

Reglas asociadas:

- **Todos los pesos de voto son enteros** (B.0.a). La delegación transfiere unidades enteras; no existe medio voto.
- Las medias de puntuación se representan como fracción exacta y **sólo se redondean para mostrar, nunca para decidir** (B.5.c).
- En estructuras hasheadas, las fracciones viajan como `{ num: "2", den: "3" }` (bigint serializado como cadena decimal), por exigencia de JCS (ADR-0004).
- `den === 0` ⇒ **no aprueba**: «cero de cero» no es unanimidad, es ausencia (B.0.d).

## Alternativas consideradas

- **Punto flotante con épsilon de tolerancia.** Traslada el problema a elegir el épsilon, que es una decisión política disfrazada de constante: con `1e-9`, alguien puede ganar por redondeo.
- **Decimales de precisión fija** (tipo `numeric` de SQL). Mejor que el flotante, pero el redondeo sigue existiendo y depende del motor de base de datos, no del dominio puro. **Además está proscrito por una segunda razón independiente**, descubierta al implementar `packages/crypto`: la **regla de tipos del ledger** (`10-ledger-inmutable.md` §1.1-bis) prohíbe almacenar en `numeric` cualquier valor que entre a la preimagen de un hash, porque `numeric` **normaliza los ceros a la derecha** —`1.50` y `1.5` son el mismo valor almacenado y se reemiten igual—, lo que cambiaría la preimagen al rehidratar el dato desde PostgreSQL. Aunque el redondeo no fuera un problema, `numeric` seguiría estando prohibido en toda columna hasheada.
- **Racionalizar todo a un denominador común** al inicio del escrutinio. Funciona, pero oscurece la `Proof`: el auditor humano deja de reconocer «2 de 3».

## Consecuencias

- El resultado es idéntico **bit a bit** en cualquier máquina, en cualquier momento, para siempre — que es el primer principio de diseño del motor.
- La `Proof` muestra fracciones legibles (`«187 de 280»`, `«2/3 exigido»`) que una persona puede verificar a mano con la tabla de papeletas.
- Los property-based tests pueden afirmar igualdad exacta en vez de aproximada, lo que hace los invariantes mucho más fuertes.

## Consecuencias negativas aceptadas

- `bigint` es más verboso y más lento que `number`, y no se puede mezclar con él sin conversión explícita. El código de escrutinio es menos agradable de leer.
- Serializar fracciones como pares de cadenas hace los payloads más ruidosos y confunde a quien lea el JSON por primera vez.
- Toda función que reciba una fracción debe respetar la invariante `den > 0n`; no hay tipo que lo garantice en TypeScript, así que depende de constructores disciplinados y de tests.
- Los cálculos estadísticos que sí son aproximados por naturaleza (el `z` del sondeo, la silueta del agrupamiento) quedan fuera de esta regla y hay que marcar claramente la frontera, o alguien intentará hacer exacta una PCA.
