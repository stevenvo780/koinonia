# ADR-0015: Barajado verificable del escrutinio con la semilla compuesta commit–reveal

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `11-privacidad-y-voto-secreto.md` §2.6 (**ADR-120 propuesto**), ataque 5: correlación por orden de inserción. Depende de la semilla compuesta de ADR-0024.

## Contexto

Aun sin marcas temporales (ADR-0014), el **orden físico de las filas** —`ctid`, secuencias, el orden natural de un `SELECT *`— sigue reproduciendo el de llegada, y ese orden es correlacionable con las marcas del padrón. Es un canal lateral que sobrevive a las dos defensas anteriores.

La solución obvia, `ORDER BY random()`, tiene un defecto fatal para este proyecto: **no es reproducible**, así que un auditor no puede recomputar el escrutinio publicado y tiene que creerle al servidor. Eso destruye la verificabilidad universal, que es justo lo que el escrutinio debe dar.

## Decisión

- El escrutinio publicado se ordena **canónicamente por `tracker`**, no por inserción.
- El orden **dentro de cada lote** se permuta con Fisher–Yates sembrado por la **semilla compuesta** ya revelada en `SeedRevealed` (`seedAdmin` comprometido antes de abrir + faro externo posterior al cierre, ADR-0024).

Así el barajado es **determinista y verificable por un tercero**: cualquiera con los artefactos públicos reconstruye el escrutinio publicado **bit a bit**.

## Alternativas consideradas

- **`ORDER BY random()`.** No reproducible; el auditor no puede recomputarlo.
- **Confiar en el orden natural de la tabla.** Es exactamente el canal lateral que se quiere cerrar.
- **Barajar con `Math.random()` en la aplicación.** Mismo problema de reproducibilidad, con el agravante de que la semilla la elige el servidor.
- **Barajar con una semilla elegida por el administrador sin faro externo.** Permitiría probar semillas hasta obtener un orden conveniente. La composición con un faro posterior al cierre lo impide.

## Consecuencias

- Reutiliza un mecanismo ya especificado (la semilla commit–reveal del sorteo), sin introducir criptografía nueva ni conceptos nuevos que explicar.
- Un auditor independiente puede reconstruir el escrutinio publicado sin acceso al servidor.
- Cierra el último canal lateral de la etapa 1 que no depende de confiar en el administrador.

## Consecuencias negativas aceptadas

- El escrutinio no se puede publicar hasta que el faro externo esté disponible y la semilla revelada: hay una demora estructural entre el cierre de la votación y la publicación.
- Si el faro elegido no publica el valor esperado (caída, cambio de servicio), el escrutinio queda bloqueado hasta resolverlo. Exige un procedimiento de contingencia declarado **antes**, no improvisado.
- Reproducir el barajado obliga al auditor a implementar exactamente el mismo Fisher–Yates, con su orden de recorrido. Es la misma objeción que la spec 30 §B.9.a hace al Fisher–Yates para el sorteo; aquí se acepta porque el destinatario de esta verificación es un auditor con herramientas, no una persona comprobando su propia posición.
