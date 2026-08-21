# `@koinonia/crypto`

La base de la garantía de integridad de Koinonía: canonicalización JCS, SHA-256, cadena de hashes
por agregado y árbol de Merkle estilo Certificate Transparency.

Implementa las secciones 1, 2, 6 y 7 de `docs/research/10-ledger-inmutable.md`.

**Cero dependencias de tiempo de ejecución.** Sólo `globalThis.crypto.subtle` y la biblioteca
estándar de ECMAScript. El mismo código corre en Node 22 y en el navegador de quien audita, que es
justamente el punto: un verificador que sólo funciona en el servidor no verifica nada.

## Qué hay dentro

| Módulo         | Qué hace                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `canonical.ts` | JCS (RFC 8785) sobre un subconjunto restringido de JSON. Una y sólo una secuencia de bytes por valor lógico. |
| `hash.ts`      | SHA-256 sobre WebCrypto, octetos de separación de dominio, hex y base64url.                                  |
| `chain.ts`     | `eventHash_n = SHA256(0x02 ‖ prevHash ‖ JCS(evento))`, verificación con **punto exacto de ruptura**.         |
| `merkle.ts`    | Árbol RFC 6962, raíz, prueba de inclusión y prueba de consistencia, con sus verificadores.                   |

```ts
import { buildChain, MerkleTree, verifyChain, verifyConsistency } from '@koinonia/crypto';

const cadena = await buildChain(eventosDeLaPropuesta);
const resultado = await verifyChain(cadena);
if (!resultado.ok) {
  console.error(`historia alterada en el evento ${resultado.brokenAt}: ${resultado.reason}`);
}
```

## Qué garantiza

1. **Determinismo de la preimagen.** Dos implementaciones honestas —V8, JavaScriptCore, un script
   en Python— obtienen la misma secuencia de bytes para el mismo valor lógico, y por tanto el mismo
   hash. Es lo que hace posible verificar en el móvil de un estudiante lo que se calculó en el VPS.
2. **Detección de modificación y de borrado parcial dentro de un agregado.** Si alguien edita el
   evento 17 o lo hace desaparecer, `verifyChain` dice **cuál** es el evento roto y por qué, no un
   "rojo" genérico.
3. **Imposibilidad de fabricar pruebas de inclusión.** Los prefijos `0x00` (hoja) y `0x01` (nodo)
   hacen que los dominios sean disjuntos: exhibir un nodo interno como si fuera una hoja exige una
   colisión real de SHA-256.
4. **Imposibilidad de reescribir el pasado sin contradecir una raíz anterior.** Si el servidor
   cambia, borra o reordena cualquiera de las primeras `m` hojas, **no existe** prueba de
   consistencia que verifique contra la raíz de tamaño `m` ya publicada. Es la propiedad que
   convierte "reescribir la historia" en "contradecir un anclaje público".
5. **Rechazo, no acomodo.** Todo valor cuya representación canónica pudiera ser ambigua —flotantes,
   enteros fuera del rango seguro, `null`, `undefined`, `-0`, texto no NFC, controles, BOM,
   sustitutos sueltos, no-caracteres— se rechaza con un error que dice el código y la ruta. Un
   canonicalizador que "arregla" la entrada produce dos verificadores que discrepan sin que nadie
   haya hecho nada mal.

## Qué NO garantiza

Decirlo es parte del diseño: un sistema de integridad que se sobrevende produce confianza falsa, que
es peor que la desconfianza.

1. **No garantiza que lo registrado sea cierto.** Prueba que un evento no cambió _después_ de
   escribirse. Un administrador que controla la aplicación puede insertar un `VotoEmitido`
   perfectamente bien formado con el `MemberId` de alguien que nunca votó. **La integridad no es
   autenticidad**, y aquí no hay firmas por miembro: no hay no-repudio.
2. **No detecta por sí solo la desaparición de un agregado entero.** Si se borran los 40 eventos de
   una propuesta, ninguna cadena se rompe: la cadena que los unía se fue con ellos. Eso lo cubren la
   espina `#ledger`, el índice global denso y el `headsRoot`, que viven en `services/api`, no aquí.
3. **No detecta una reescritura completa si nadie guardó nada.** Un ledger reescrito desde el
   génesis es internamente perfecto. Sólo lo delata la comparación con una raíz anterior. Este
   paquete provee el álgebra de esa comparación; **conservar la raíz vieja es un problema social**.
4. **No ancla nada.** Publicar y anclar externamente el checkpoint es responsabilidad de otro
   paquete. Sin anclaje, la prueba de consistencia sólo protege a quien tenga un checkpoint previo.
5. **No es agilidad criptográfica.** SHA-256 está fijado en toda la historia. Si algún día se rompe,
   migrar exige rehashear todo y publicar una transición firmada: un procedimiento que no está
   diseñado.
6. **No protege contra el código servido por el verificado.** Si el navegador ejecuta el JavaScript
   que sirve el servidor auditado, ninguna criptografía dentro de ese código lo arregla.
7. **No oculta nada.** El paquete no cifra. `MemberId` es un seudónimo, no anonimato.

## Reglas del perfil del ledger

`LEDGER_PROFILE` (por defecto) rechaza, además de lo que rechaza RFC 8785:

- números con parte fraccionaria y enteros fuera de `[-(2^53-1), 2^53-1]` — las cantidades se
  expresan como enteros en la unidad mínima o como cadena decimal;
- `null`, `undefined` y `-0` — la ausencia se expresa **omitiendo la clave**;
- claves que no cumplan `^[A-Za-z][A-Za-z0-9_]*$`;
- cadenas que no estén en NFC (no se normalizan aquí: se normalizan en el borde con `toLedgerText`);
- caracteres de control salvo tabulador y salto de línea, `U+FEFF`, no-caracteres y sustitutos
  sueltos.

`RFC8785_PROFILE` levanta esas restricciones y existe **sólo** para correr los vectores oficiales
del RFC, que contienen `null` y flotantes. No se usa para hashear nada del ledger.

## Notas sobre la especificación

Al implementar `10-ledger-inmutable.md` aparecieron discrepancias; están anotadas en el código como
`// DECISIÓN:` y resumidas en `reportes/`. Las tres que más importan:

- el `SUBPROOF` del §7.2 no contempla `m = 0` y calcularía `k` sobre `n - 1 = 0`;
- `1 << (31 - Math.clz32(n - 1))` sólo es correcto para `2 <= n < 2^31`;
- `actor` es "32 hex minúsculas" en §1.1 pero `uuid` en el DDL del §3.1, y PostgreSQL devuelve los
  `uuid` **con guiones**: reconstruir el evento desde la base cambiaría la preimagen.

## Desarrollo

```sh
pnpm test          # vitest, incluidas las property-based con fast-check
pnpm typecheck     # tsc estricto sobre fuentes y pruebas
pnpm lint          # eslint + prettier + guardián de pureza del dominio
```
