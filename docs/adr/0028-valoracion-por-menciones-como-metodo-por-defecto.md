# ADR-0028: Valoración por menciones (Majority Judgment) como método por defecto

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `30-decision-engine-spec.md` §B.7, DECISIONES B.7.a, B.7.b y B.7.c; `03-deliberativa-sistemas-antipatrones.md` §5.7 (contramedida a la captura por bloque organizado).

## Contexto

Con 300 personas, la mayoría simple sobre dos opciones es honesta pero pobre; con tres o más opciones aparecen todas las patologías conocidas: división del voto, voto estratégico y el hecho de que **un bloque disciplinado del 30 % domina una mayoría fragmentada**.

La comparación de los métodos disponibles (spec 30, parte B) deja a Majority Judgment (Balinski–Laraki) como el mejor ajuste para esta comunidad concreta, por razones que no son sólo matemáticas.

## Decisión

**`majority-judgment` es el método por defecto para toda decisión con dos o más opciones sustantivas.**

- La definición normativa del desempate es la **eliminación sucesiva de una ocurrencia de la mención mediana**, no la fórmula del *gauge* (B.7.a): son equivalentes en resultado y sólo la primera es explicable a mano.
- `missingGradePolicy` por defecto es `'reject-ballot'` (B.7.b): la papeleta debe valorar todas las opciones o no es válida.

Las razones que lo hacen preferible aquí:

1. **Resiste el voto estratégico** mejor que las escalas cardinales, porque la mediana es insensible a las exageraciones de los extremos.
2. **Distingue polarización de tibieza.** Muchos «Excelente» y muchos «Rechazar» es una situación distinta de todo «Aceptable», y cualquier método de un solo número las confunde. Para una comunidad que quiere **discutir** y no sólo decidir, esa distinción es material deliberativo de primer orden.
3. **Evita el problema de comparabilidad cardinal** de la puntuación 0–5: las menciones son un lenguaje ordinal común y compartido, no una escala numérica que cada quien interpreta a su manera. Es exactamente la objeción que un filósofo le haría al *score voting*.
4. **Su patología es rara y explicable**, mientras que la de IRV es estructural y contraintuitiva, y la de Condorcet exige explicar por qué no hay ganador — la peor conversación posible en una asamblea.
5. **No mueve la mención mediana** un bloque coordinado del 30 %, que es la contramedida directa al antipatrón de captura organizada.

## Alternativas consideradas

- **Mayoría simple.** Correcta para binarias; con 3+ opciones divide el voto y premia al bloque más disciplinado.
- **Puntuación 0–5 (*score voting*).** Vulnerable a exageración estratégica y a la incomparabilidad de escalas entre personas.
- **Rondas con eliminación (IRV).** No monotónica: subir en las preferencias de alguien puede hacerte perder. Vetado por la spec 30 para personas y estatutos.
- **Condorcet + Schulze.** Teóricamente muy sólido; el ciclo obliga a explicar «A gana a B, B gana a C, C gana a A» ante una asamblea, y el algoritmo no es verificable a mano.

## Consecuencias

- Un solo método por defecto que la comunidad puede aprender bien, en vez de un catálogo que nadie domina.
- La `Proof` es legible: menciones, mediana y eliminación sucesiva se siguen con la tabla delante.
- La distribución completa de menciones se publica y alimenta la deliberación posterior.

## Consecuencias negativas aceptadas

- **Exige más esfuerzo al votante**: valorar todas las opciones, no marcar una. Con `'reject-ballot'` como política por defecto, una papeleta incompleta se pierde.
- La mediana puede resultar contraintuitiva para quien espera «ganó el más votado»; hará falta pedagogía sostenida.
- **Contradice `02-sociocracia-ostrom.md` §1.5** en lo relativo a elegir personas, donde la spec 30 B.7.c declara a MJ «el único método permitido» y el doc 02 prescribe elección sociocrática sin candidatos. Contradicción **C12**, pendiente de resolución del arquitecto; este ADR **no** la resuelve y por tanto no debe leerse como veto del procedimiento sociocrático de nominación.
