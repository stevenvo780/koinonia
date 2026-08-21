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

1. Toda colección que represente un conjunto se serializa como **arreglo ordenado ascendentemente por su clave**, comparando **byte a byte el UTF-8** (`<` sobre code points). **`localeCompare` queda prohibido en todo `packages/domain`**, con regla de lint que lo verifica.
2. Ningún campo `undefined`: la ausencia se representa **omitiendo la clave**, nunca con `null` ni con la clave presente y vacía.
3. Ningún `number` con parte fraccionaria dentro de una estructura hasheada. Las fracciones se representan como `{ num: "2", den: "3" }` (bigint serializado como cadena decimal).

## Alternativas consideradas

- **Serialización JSON ad hoc con claves ordenadas**, escrita por nosotros. Es lo que hace casi todo el mundo y falla en los casos de borde: escapes Unicode, pares subrogados, `-0`, números grandes. JCS es un estándar con vectores de prueba públicos; nuestra función no.
- **Formatos binarios canónicos** (CBOR canónico, Protobuf determinista). Técnicamente sólidos, pero el auditor pierde la capacidad de **leer** lo que se hasheó. La legibilidad del artefacto auditado es un requisito político, no una comodidad.
- **Hashear el texto ya almacenado** en lugar de recanonicalizar. Ata el hash a un detalle de la capa de persistencia y se rompe en la primera migración de esquema.

## Consecuencias

- El servidor, el navegador y un script de terceros producen el mismo hash sobre el mismo objeto lógico. La verificación independiente es realizable.
- Las reglas 1–3 son verificables mecánicamente: hay lint para `localeCompare` y property-based tests que serializan estructuras generadas y comparan hashes entre implementaciones.
- La aritmética exacta (ADR-0027) encaja de forma natural: las fracciones ya viajan como pares de cadenas.

## Consecuencias negativas aceptadas

- JCS no admite todo JSON: los números fuera del rango seguro de IEEE-754 no son representables de forma canónica. Por eso la regla 3 obliga a modelar cantidades exactas como cadenas, lo que es incómodo de leer y fácil de olvidar.
- Cada estructura nueva que llegue al ledger exige revisar su serialización. Es trabajo recurrente y aburrido, y por eso está respaldado por tests y no por disciplina.
- Recanonicalizar en cada verificación cuesta CPU. Despreciable a esta escala.
