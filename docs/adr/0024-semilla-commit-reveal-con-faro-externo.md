# ADR-0024: Semilla de aleatoriedad compuesta por commit–reveal más faro externo

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `30-decision-engine-spec.md` §B.0.3 y DECISIÓN B.0.c; `03-deliberativa-sistemas-antipatrones.md` §4 (ancla criptográfica sin criptomoneda) y §1.3.1 (sorteo verificable, no confiable).

## Contexto

Dos mecanismos del sistema necesitan aleatoriedad que nadie pueda manipular: el **sorteo deliberativo estratificado** (ADR-0031) y el **barajado del escrutinio** (ADR-0015). En ambos, quien controla la semilla controla el resultado.

Las dos soluciones ingenuas fallan de forma simétrica. Si la semilla la elige el administrador, puede probar semillas hasta que salga el comité que le conviene. Si se toma sólo de una fuente externa conocida de antemano, quien conozca la fuente puede anticipar el resultado y actuar en consecuencia.

## Decisión

**La semilla es SIEMPRE compuesta:**

```
seed = sha256( seedAdmin || "|" || beaconValue )
```

Con dos condiciones que la hacen funcionar:

1. **Compromiso previo.** `seedCommitment = sha256(seedAdmin)` se publica **antes** de `opensAt` y entra dentro del `configHash`, de modo que queda congelado junto con el resto de la configuración.
2. **Faro externo posterior.** `beaconValue` es un valor público, impredecible e inmanipulable, **publicado después del cierre**: el hash de un bloque de Bitcoin de altura anunciada de antemano, o un faro de aleatoriedad equivalente.

`SeedRevealed` sólo se acepta si `sha256(seedAdmin) === seedCommitment`; si falla, la decisión pasa automáticamente a `Annulled`.

Éste es el uso honesto de una blockchain: **no se compra ni se transfiere nada, se lee un número público**. Es un reloj aleatorio compartido, no criptoeconomía.

## Alternativas consideradas

- **Semilla elegida por el administrador.** Permite probar hasta obtener el resultado deseado.
- **Sólo faro externo, sin `seedAdmin`.** Conocida la altura del bloque de antemano, cualquiera con capacidad de influir sobre el padrón puede anticipar quién saldrá.
- **`Math.random()` o el reloj.** No reproducible; el auditor tendría que creerle al servidor.
- **Un servicio de aleatoriedad de terceros con API.** Introduce un tercero de confianza justo donde el objetivo es eliminarlo.

## Consecuencias

- Ni el administrador ni el faro pueden determinar el resultado por separado: haría falta que el administrador previera el bloque futuro, que es el punto entero.
- El sorteo es **verificable, no confiable**: cualquiera calcula `hmac(semilla, "estrato|suID")` con una línea de comando y comprueba su propia posición.
- El mismo mecanismo sirve para el sorteo, el barajado del escrutinio, los desempates de cuotas y el panel de admisibilidad de objeciones: una sola pieza que explicar.

## Consecuencias negativas aceptadas

- **Hay que esperar al faro.** El sorteo y el escrutinio no se resuelven en el instante del cierre; la demora es estructural.
- Dependencia de un servicio externo que puede caer o cambiar. Exige un procedimiento de contingencia declarado **antes** —qué altura de respaldo se usa, quién lo decide— y no improvisado el día que falle.
- Si el administrador «pierde» `seedAdmin` tras comprometerlo, la decisión se anula. Es el incentivo correcto, pero significa que un fallo de custodia rutinario tumba una decisión legítima.
- Explicar por qué se usa un bloque de Bitcoin a una asamblea que rechaza explícitamente la criptomoneda exige cuidado: el ADR-0039 prohíbe tokens y esto no es un token, pero la distinción hay que hacerla en voz alta.
