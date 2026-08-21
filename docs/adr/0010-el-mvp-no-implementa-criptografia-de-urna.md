# ADR-0010: El MVP no implementa criptografía de urna; voto seudónimo con recibo y declaración explícita de garantías

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** decisión estructural del arquitecto; consolida el **ADR-117** propuesto en `11-privacidad-y-voto-secreto.md` §2.4.

## Contexto

Los siete requisitos de un voto secreto verificable (doc 11 §2.1) van de la elegibilidad a la resistencia a coerción. Ningún sistema de voto remoto por navegador cumple el séptimo, y casi ninguno lo dice.

La tentación es integrar Helios o Belenios desde el día uno. El argumento en contra no es la pereza: **un sistema cifrado mal integrado, con custodios que no entienden su rol y un escrutinio que nadie sabe verificar, ofrece menos garantías reales que un esquema simple bien explicado — y ofrece la ilusión de ofrecer más, que es peor.** La ceremonia de custodios depende de que cinco personas hagan bien una tarea aburrida una vez al año; hecha con prisa antes de un parcial, se rompe.

## Decisión

**Etapa 1 (MVP): voto seudónimo con recibo.** Cuatro piezas:

1. **Separación física de tablas** — `roll.voter_marks` (quién votó, sin el voto, con `PRIMARY KEY (decision_id, member_id)`) y `urn.ballots` (qué se votó, sin el votante), en esquemas distintos, sin clave foránea (ADR-0013).
2. **Recibo / tracker** — el navegador genera 160 bits aleatorios y deriva un código legible (`K7F2-9QMX-3B`) que envía con la papeleta. Al cerrar se publica la tabla `(tracker, choice)`: cada quien busca su código y comprueba su voto; cualquiera suma la columna y verifica el resultado.
3. **Firma y anclaje** — árbol de Merkle sobre las papeletas ordenadas por `tracker`, evento `TallySigned` y entrada de `urnRoot` en la raíz Merkle diaria anclada externamente (ADR-0005, ADR-0016).
4. **Declaración explícita de garantías** en la interfaz, antes del primer voto (ADR-0017).

Lo que el MVP **no** promete queda escrito en la propia pantalla de votación, no escondido en un README: no hay resistencia a coerción, y **el administrador del servidor puede, en principio, ver quién votó qué**.

## Alternativas consideradas

- **Belenios desde el día uno.** El coste de integración —es un servicio federado, no una biblioteca— más la operación de custodios excede la capacidad del equipo y retrasa el MVP meses. Es el destino de la etapa 2 (ADR-0018).
- **Helios.** Su debilidad es exactamente nuestro riesgo principal: el servidor puede emitir votos por los abstencionistas y nadie reclama, porque quien no votó no revisa la urna.
- **Implementación propia de ElGamal en TypeScript.** Irresponsable: la criptografía de elecciones se ataca durante años antes de ser confiable.
- **No prometer secreto en absoluto** y hacer todo voto nominal. Descartada porque `20-normativa-datos-colombia.md` §2.1 clasifica el contenido del voto como dato sensible y `03-deliberativa-sistemas-antipatrones.md` §2 exige secreto cuando la decisión recae sobre personas.

## Consecuencias

- El MVP es implementable y **auditable a mano**: la lista `(tracker, choice)` se recuenta con papel y lápiz, que es la forma de verificación que 300 estudiantes de filosofía sí pueden ejercer.
- La confianza requerida queda **nombrada y acotada**: una persona concreta, identificada públicamente, con controles organizativos y rastro. No es una confianza difusa en «el sistema».
- La migración a criptografía real no rompe el histórico, porque cada decisión sella qué backend la produjo y qué garantizaba (ADR-0011).
- La comunidad decide con información real si un tema debe votarse aquí o en papel. Esa decisión es política y le corresponde a ella.

## Consecuencias negativas aceptadas

- **El administrador del servidor puede violar el secreto del voto.** Tiene acceso a las dos tablas. La separación de esquemas, la ausencia de marcas temporales y el sellado por lotes elevan el coste y dejan rastro, pero no lo impiden matemáticamente.
- Frente a la sustitución de papeletas hay **detección, no prevención**: se detecta sólo si la gente revisa su tracker, y casi nadie revisa.
- Un administrador que añade un voto por alguien que no votó **puede lograrlo** si el total sigue bajo el censo y esa persona nunca revisa. Es el agujero que Belenios cierra y la razón principal para migrar.
- Esta decisión **contradice el requisito** de `20-normativa-datos-colombia.md` §2.3 («el vínculo voto↔votante no debe existir en ningún almacén; ni el administrador con acceso total puede reconstruirlo»). Se acepta conscientemente, se declara en la interfaz y queda registrada como contradicción **C6** en `00-contradicciones-resueltas.md`.
