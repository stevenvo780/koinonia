# ADR-0016: Anclaje del padrón, del conteo de marcas y del escrutinio como triple contador

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `11-privacidad-y-voto-secreto.md` §2.6 (**ADR-121 propuesto**), ataque 6: el administrador que añade votos.

## Contexto

En la etapa 1 no hay firma de credencial que impida fabricar una papeleta. Dicho de frente: **un administrador que añade un voto por alguien que no votó puede lograrlo** si el total sigue por debajo del censo y esa persona nunca revisa su recibo.

Lo que sí se puede construir es un sistema de **contadores cruzados** que haga que cualquier manipulación produzca una inconsistencia aritmética visible para cualquiera, sin acceso privilegiado.

## Decisión

Se anclan externamente **cuatro valores** por decisión: `rollRoot` (raíz del padrón congelado), `|marcas|` (número de personas que votaron), `urnRoot` (raíz Merkle de las papeletas) y `ballotCount`.

Tres controles se derivan de ellos:

1. `ballotCount ≤ censusSize` — verificable por cualquiera contra el padrón anclado.
2. `ballotCount === |marcas|` — un voto añadido sin marca, o una marca borrada para votar dos veces, rompe la igualdad.
3. Toda papeleta admitida corresponde a un `member_id` presente en el padrón anclado.

**Cualquier discrepancia dispara `DecisionAnnulled` automático por inconsistencia**, igual que la DECISIÓN A.8 de la spec 30 (ADR-0026).

**El anclaje debe ocurrir ANTES de publicar el resultado.** Si se publica primero y se ancla después, el control no vale nada: da margen para cuadrar los libros.

## Alternativas consideradas

- **Anclar sólo el resultado.** Permite ajustar padrón, marcas y papeletas hasta que cuadren y anclar después un conjunto coherente pero falso.
- **Anclar sólo el padrón.** Detecta el voto de un inelegible, no el voto fabricado por alguien elegible que no participó.
- **Confiar en la revisión de los votantes.** Es la única defensa contra la sustitución de papeletas (ADR-0010) y ya sabemos que casi nadie revisa; no puede ser también la única contra el relleno.

## Consecuencias

- El relleno de urna deja de ser invisible: exige mantener tres contadores coherentes entre sí y con lo ya anclado, lo que es imposible una vez publicada el ancla.
- La anulación por inconsistencia es automática y no depende de que alguien denuncie.
- Encaja con ADR-0005: los cuatro valores viajan dentro de la raíz Merkle diaria, sin mecanismo nuevo.

## Consecuencias negativas aceptadas

- **El resultado no se publica en el instante del cierre**: hay que anclar primero, y el anclaje depende de un servicio externo. La demora es estructural y hay que explicarla.
- Un fallo del servicio de anclaje bloquea la publicación de un resultado ya calculado, en el momento de máxima expectativa de la comunidad.
- La anulación automática es un arma de doble filo: un error de nuestro propio código en el conteo de marcas anularía una decisión legítima. Exige que esos tres contadores estén cubiertos por invariantes de property-based testing antes de habilitar la anulación automática.
- Sigue sin **prevenir** nada: detecta. La prevención llega con las papeletas firmadas de la etapa 2 (ADR-0018).
