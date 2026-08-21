# ADR-0030: La delegación está prohibida —no inerte— en decisiones con voto secreto

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `30-decision-engine-spec.md` §C.7, DECISIONES C.7.a–e; `03-deliberativa-sistemas-antipatrones.md` §2 (voto secreto y rendición de cuentas).

## Contexto

Hay una imposibilidad honesta que casi nadie enuncia: **el voto secreto y la delegación verificable son incompatibles**. Si delegué mi voto, tengo derecho a saber cómo se usó; si el voto es secreto, nadie puede saberlo — incluido yo. No es un problema de implementación: es una contradicción entre dos derechos.

El argumento decisivo es el que hace la spec 30 §C.7.2: **el ciudadano vota en secreto, el representante vota en acta**. Aceptar un mandato es aceptar la publicidad del ejercicio. El secreto protege a quien vota por sí mismo frente a la presión; no protege a quien ejerce poder ajeno frente a la rendición de cuentas.

## Decisión

- **En `privacy: 'secret-ballot'` la delegación está PROHIBIDA.** No «inerte», no «ignorada»: prohibida. El sistema rechaza abrir la decisión si hay delegaciones vigentes en su ámbito, y avisa a los delegantes de que deben votar en persona.
- **En `sealed-tally` con delegación habilitada, la papeleta del delegado es pública** mientras la delegación esté vigente.
- **Recibo de ejercicio con prueba de inclusión:** al cierre, cada delegante recibe una prueba Merkle de que su `memberId` está en el conjunto `onBehalfOf` de la papeleta de su delegado.
- **Ventana de última palabra:** la papeleta del delegado se revela a **sus delegantes** con antelación al cierre, de modo que quien no esté de acuerdo pueda votar por sí mismo y revocar el efecto.
- **En `public-roll-call` no hay nada que resolver:** todo es público, incluidas las cadenas.

En una frase: **el voto que carga peso delegado nunca puede ser secreto** (`03-deliberativa-sistemas-antipatrones.md` §2).

## Alternativas consideradas

- **Delegación «inerte» en secreto** (se acepta la delegación pero no surte efecto). Es la peor opción: el delegante cree que participó y no participó, y sólo lo descubre —si acaso— al ver el conteo.
- **Delegación secreta con recibo criptográfico.** Exige criptografía que la etapa 1 no tiene, y aun con ella el recibo que prueba el ejercicio es el mismo objeto que permite coaccionar (doc 11, límite 1).
- **Prohibir el voto secreto para que la delegación siempre funcione.** Inaceptable: `20-normativa-datos-colombia.md` §2.1 clasifica el contenido del voto como dato sensible y hay decisiones —sobre personas, sanciones, reparto de recursos— donde el secreto es la única defensa contra la retaliación.

## Consecuencias

- No hay ambigüedad: en cada decisión, o hay secreto o hay delegación, y se sabe **antes** de abrir.
- Quien ejerce poder ajeno responde por él públicamente, que es la condición mínima para que la delegación sea legítima.
- La ventana de última palabra convierte la delegación en revocable **en el momento que importa**, no en abstracto.

## Consecuencias negativas aceptadas

- **Baja la participación en las decisiones secretas**: quienes delegaban porque no pueden estar, simplemente no votan. Y las decisiones secretas son, por definición, las más delicadas.
- Obliga a decidir el modo de privacidad **antes** de abrir, sin poder cambiarlo después. Una votación secreta no puede volverse nominal retroactivamente (`20-normativa-datos-colombia.md` §2.3), ni al revés.
- La ventana de última palabra revela la posición del delegado antes del cierre a un subconjunto de personas, lo que introduce una asimetría de información entre delegantes y no delegantes.
- Gestionar delegaciones que quedan suspendidas por el modo de privacidad de cada decisión es confuso de explicar y de mostrar en la interfaz.
