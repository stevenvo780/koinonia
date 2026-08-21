# ADR-0032: Presunción de validez de la objeción, con panel sorteado y silencio a favor del objetante

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `30-decision-engine-spec.md` §B.3, DECISIONES B.3.a–e; `02-sociocracia-ostrom.md` §1.2 (criterios de admisibilidad y garantías).

## Contexto

En el consentimiento sociocrático, una objeción detiene la decisión. Por eso **calificar objeciones es el poder más peligroso del sistema: quien decide qué disenso cuenta, gobierna**. Si el facilitador califica, el rol procedimental se convierte en el rol soberano sin que nadie lo haya votado.

El riesgo simétrico también es real: sin criterios, cualquier «no me gusta» bloquea, y el consenso puro convierte a la minoría de uno en carcelero (`01-decidim-loomio-polis.md` §2).

## Decisión

**Toda objeción nace admitida.** La carga de la prueba recae sobre quien quiere desestimarla, no sobre quien objeta.

- **Desestimación sólo por panel de 3 personas sorteadas del propio círculo**, con la semilla pública (ADR-0024), **mayoría de 2/3** y motivación escrita publicada.
- **Silencio administrativo a favor del objetante:** vencido `panelDeadline` sin pronunciamiento, la objeción queda admitida.
- **El facilitador no califica. Nunca.** Su rol es procedimental.
- **Exclusiones del sorteo:** quien objeta, quien propuso y quien tenga vínculo declarado con ambos. El objetante puede **recusar a un panelista una vez, sin motivar**.
- **Apelación al círculo superior por la vía del doble vínculo**, nunca al administrador técnico.
- Cinco tests de admisibilidad, con verificación mecánica parcial: anclaje (`harmedAim` apunta a un objetivo declarado, sin texto libre), impersonalidad, contrafáctico observable, enmienda imaginable y dominio. Una objeción sin enmienda posible sigue siendo admisible pero se marca `irreducible` y activa el escalamiento.
- **Integrar una objeción exige la firma del objetante**: no basta con declarar que fue integrada.
- **El silencio no consiente**: `silenceMeans` por defecto es `'not-participating'`.
- **Anti-obstrucción:** una objeción sustancialmente idéntica ya desestimada se marca `reiterada` y no reabre ronda; `maxRounds` por defecto 3, tope duro 5.
- **Métrica pública anti-captura:** tasa de desestimación por círculo y período. Una tasa alta y sostenida dispara un driver de revisión del acuerdo que fija la admisibilidad.

## Alternativas consideradas

- **El facilitador califica.** Concentra el poder decisivo en un rol que se presenta como neutral.
- **Presunción de invalidez** (la objeción debe probarse antes de surtir efecto). Invierte la carga contra quien discrepa, que es siempre la parte más débil.
- **Bloqueo absoluto sin procedimiento** (consenso puro). Convierte a la minoría de uno en rehén; la salida real acaba siendo informal, y ahí gobierna quien facilita.
- **Sin tope de rondas.** Sin condición de parada, la decisión no termina y el desgaste selecciona por disponibilidad horaria.

## Consecuencias

- Objetar es seguro: no hay que convencer a nadie de que la objeción «cuenta» antes de que surta efecto.
- El poder de calificar está repartido, es sorteado, es recusable y deja motivación escrita.
- El procedimiento termina siempre: rondas acotadas más escalamiento explícito.

## Consecuencias negativas aceptadas

- **Se puede obstruir de buena fe.** La presunción de validez permite frenar con objeciones débiles hasta que el panel se pronuncie; el coste lo paga la comunidad en tiempo.
- El panel sorteado puede tocarle a gente sin contexto ni ganas, y su decisión será igual de vinculante.
- El silencio a favor del objetante castiga la inacción del panel con un resultado sustantivo, lo que puede usarse tácticamente: basta con que tres personas no aparezcan.
- Los cinco tests son sólo **parcialmente** verificables por máquina; el resto depende de lectura humana, con toda su variabilidad.
