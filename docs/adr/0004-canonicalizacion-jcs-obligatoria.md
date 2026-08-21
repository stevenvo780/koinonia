# ADR-0004: Canonicalización JCS (RFC 8785) obligatoria antes de hashear

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** decisión estructural del arquitecto; `30-decision-engine-spec.md` §A.1.1 y DECISIÓN A.0.b (prohibición de `localeCompare`).

## Contexto

Dos implementaciones honestas del mismo objeto producen dos JSON distintos: orden de claves, espaciado, escapes Unicode, `-0`, notación de exponentes, presencia de claves con valor `undefined`. Si el hash se calcula sobre la serialización ingenua, **el servidor y el verificador independiente obtienen hashes distintos sin que nadie haya hecho nada mal**, y el fallo se manifiesta como «la auditoría no cuadra» — la peor conversación posible en una asamblea que ya desconfía.

El problema es más sutil de lo que parece: `Array.prototype.sort` sin comparador, la iteración sobre `Object.keys`, o un `localeCompare` cuyo resultado depende de ICU y de la locale del proceso, producen fallos **silenciosos, intermitentes y dependientes del entorno**.

## Decisión

Todo hash del sistema se calcula como:

```
hash(x) = sha256Hex( utf8( jcs( x ) ) )   // JSON Canonicalization Scheme, RFC 8785
```

Con tres reglas adicionales obligatorias **antes** de aplicar JCS:

1. Toda colección que represente un conjunto se serializa como **arreglo ordenado ascendentemente por su clave**, comparando **por unidades de código UTF-16**, que es exactamente lo que hace el operador `<` de JavaScript sobre cadenas y lo que manda JCS (RFC 8785 §3.2.3). **`localeCompare` queda prohibido en todo `packages/domain` y en `packages/crypto`**, con regla de lint que lo verifica.

> **Corregido tras la implementación (2026-08-21):** esta regla decía «comparando **byte a byte el UTF-8** (`<` sobre code points)», y era **incorrecta por partida doble**. Primero, la propia frase se contradice: el `<` de JavaScript **no** compara code points, compara unidades de código UTF-16. Segundo, y peor, contradecía a `10-ledger-inmutable.md` §1.3.c, que ya mandaba el orden por unidades de código UTF-16. Dos documentos, dos funciones de orden distintas, y ninguna forma de saber cuál aplicar al implementar.
>
> **No son la misma función fuera del plano básico.** Los sustitutos UTF-16 caen en `D800`–`DFFF`, así que todo carácter suplementario (U+10000 en adelante) se ordena *antes* que `U+E000`–`U+FFFF`, mientras que en bytes UTF-8 se ordena *después*. El caso que lo demuestra:
>
> ```js
> '😂' < '\ufb33'                       // true  — UTF-16: 0xD83D < 0xFB33  (lo que manda JCS)
> utf8('😂') < utf8('\ufb33')           // false — UTF-8:  F0 9F 98 82 > EF AC B3
> ```
>
> Con dos claves así en un mismo objeto —un `payload` con un emoji y un carácter hebreo presentado—, un canonicalizador «byte a byte UTF-8» y uno JCS emiten **objetos distintos y por tanto hashes distintos**, y el falso positivo de corrupción es indistinguible de una alteración real. **Manda JCS: orden por unidades de código UTF-16.** El apéndice de RFC 8785 lo define así precisamente para que `JSON.stringify` de ECMAScript sea la implementación de referencia, que es todo el argumento de por qué elegimos JCS.
>
> La restricción de claves a `^[a-zA-Z][a-zA-Z0-9_]*$` (spec 10, §1.3.c) hace que hoy la diferencia no se materialice en el `payload`. No sirve como defensa: la regla 1 de este ADR se aplica a **toda colección que represente un conjunto**, incluidos valores de dominio —nombres de círculo, textos de opción, etiquetas— donde el emoji sí llega.
2. Ningún campo `undefined`: la ausencia se representa **omitiendo la clave**, nunca con `null` ni con la clave presente y vacía.
3. Ningún `number` con parte fraccionaria dentro de una estructura hasheada. Las fracciones se representan como `{ num: "2", den: "3" }` (bigint serializado como cadena decimal).

## Alternativas consideradas

- **Serialización JSON ad hoc con claves ordenadas**, escrita por nosotros. Es lo que hace casi todo el mundo y falla en los casos de borde: escapes Unicode, pares subrogados, `-0`, números grandes. JCS es un estándar con vectores de prueba públicos; nuestra función no.
- **Formatos binarios canónicos** (CBOR canónico, Protobuf determinista). Técnicamente sólidos, pero el auditor pierde la capacidad de **leer** lo que se hasheó. La legibilidad del artefacto auditado es un requisito político, no una comodidad.
- **Hashear el texto ya almacenado** en lugar de recanonicalizar. Ata el hash a un detalle de la capa de persistencia y se rompe en la primera migración de esquema.

## Consecuencias

- El servidor, el navegador y un script de terceros producen el mismo hash sobre el mismo objeto lógico. La verificación independiente es realizable.
- Las reglas 1–3 son verificables mecánicamente: hay lint para `localeCompare` y property-based tests que serializan estructuras generadas y comparan hashes entre implementaciones. **Los generadores de esas pruebas incluyen obligatoriamente caracteres fuera del BMP**, porque el orden UTF-16 y el orden UTF-8 sólo divergen ahí y una batería de sólo-ASCII habría dado verde sobre la regla equivocada durante años.
- Una implementación futura del verificador en Go o Rust **no puede usar el orden natural de cadenas de esos lenguajes**, que es por bytes UTF-8. Debe ordenar por unidades de código UTF-16 explícitamente. Va en `README-VERIFICACION.txt` (spec 10 §9.3), porque es el error que cualquier reimplementador cometería.
- La aritmética exacta (ADR-0027) encaja de forma natural: las fracciones ya viajan como pares de cadenas.

## Consecuencias negativas aceptadas

- JCS no admite todo JSON: los números fuera del rango seguro de IEEE-754 no son representables de forma canónica. Por eso la regla 3 obliga a modelar cantidades exactas como cadenas, lo que es incómodo de leer y fácil de olvidar.
- Cada estructura nueva que llegue al ledger exige revisar su serialización. Es trabajo recurrente y aburrido, y por eso está respaldado por tests y no por disciplina.
- Recanonicalizar en cada verificación cuesta CPU. Despreciable a esta escala.
