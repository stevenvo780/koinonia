# ADR-0047: Métodos de escrutinio completos, con aritmética exacta y anti-invariantes probados en positivo

- **Estado:** Aceptado
- **Fecha:** 2026-08-22
- **Contexto de origen:** `30-decision-engine-spec.md` PARTE B.5–B.9 e `INV-42..51`, `INV-55..57`;
  `TESTING.md` §«El caso de IRV» y §14; ADR-0026, ADR-0027, ADR-0028, ADR-0031 y ADR-0041.

## Contexto

El motor cerraba consentimiento, mayoría simple, supermayoría y unanimidad, y dejaba fuera los cinco
métodos que la especificación describe con más detalle: puntuación (B.5), preferencia transferible
(B.6), valoración por menciones (B.7), Condorcet/Schulze (B.8) y sorteo estratificado verificable
(B.9). Entre ellos está el método que ADR-0028 declara **por defecto** para el proyecto, de modo que
el motor no podía todavía ejecutar su propia decisión por defecto.

Implementarlos ejerce dos reglas que hasta ahora sólo se habían aplicado a piezas más simples:

- **ADR-0027**, aritmética exacta, es incómoda justo aquí. Los cinco métodos están llenos de
  medianas, cuotas, restos y umbrales, y todos ellos son el sitio natural donde alguien escribe una
  división en punto flotante. La spec 30 lo hace en B.9.
- **Tres de los métodos incumplen a propósito propiedades que a un lector le parecen obligatorias.**
  Un arnés de pruebas que las enuncie como invariantes generales acabará en rojo, y el reflejo será
  «arreglar» el motor hasta el verde. Eso introduciría un bug real en un escrutinio.

## Decisión

Los cinco métodos quedan implementados en `packages/domain/src/tally/`, con `majority-judgment` como
método por defecto (ADR-0028) y sin ninguna dependencia de runtime.

### Aritmética exacta, sin excepciones para las cuotas

Todos los umbrales, cuotas y restos se calculan con **enteros y fracciones exactas**, comparados por
multiplicación cruzada. **Ningún `number` en punto flotante participa de una comparación que decida un
resultado.** El redondeo existe sólo para mostrar.

Donde esto choca de frente con el documento es el sorteo. **B.9 calcula las cuotas por división en
punto flotante, y ADR-0027 gana sobre la spec 30** por la jerarquía normativa de `adr/README.md`. El
reparto es Hamilton con productos, cocientes y restos **enteros**: el producto `sampleSize × peso` se
hace en `bigint`, el cociente y el resto son exactos, y el orden de los restos se resuelve con un
ticket verificable, no con un `Math.round`. Un empate de restos decidido por error de coma flotante
sería un empate decidido por el orden de las sumas, es decir por nada.

### La mediana de Majority Judgment: el invariante es semántico, la fórmula no

Esta es la decisión que más cuidado exige, porque en el camino se cometió un error y se corrigió.

**El invariante semántico, que es lo único normativo:** con `W` par se toma la **peor** de las dos
menciones centrales —el *lower middlemost* pesimista de Balinski–Laraki—. «Lower» significa **peor**,
no «de índice menor». Es la única lectura que sostiene el enunciado «al menos la mitad la considera al
menos `α`».

**La fórmula depende de la orientación del vector, y por eso B.5 y B.7 necesitan fórmulas distintas
para lograr exactamente lo mismo:**

| Método | Orientación del vector | Peor de las dos centrales | Fórmula |
|---|---|---|---|
| B.7 (menciones) | de mejor a peor, `0` = Excelente | índice **mayor** | `floor(W/2)` |
| B.5 (puntuación) | de peor a mejor, `0` = la puntuación más baja | índice **menor** | `floor((W-1)/2)` |

Copiar `floor(W/2)` en B.5 devuelve la **mejor** de las dos centrales, que es la mención contraria a
la que manda la convención. **Lo falso, por tanto, es la frase de la spec «misma convención que B.7»**
en B.5: la convención semántica sí es la misma; la fórmula no puede serlo. Queda registrado como
errata **E25**.

Queda también registrado, y a la vista, que **la primera lectura de este mismo asunto fue un error del
orquestador y no de la especificación**: se llegó a implementar `floor((W-1)/2)` sobre el vector de
B.7 y a dejar anclado por escrito en un test un conflicto con INV-49 que no existía. La spec era
coherente consigo misma. Esa entrada figura en el registro como **E24 RETIRADA**, tachada y con su
explicación, no borrada.

### Tres propiedades que fallan a propósito, y se prueban en positivo

`TESTING.md` prohíbe `skip`. Un método que incumple una propiedad no se excluye en silencio: **se
escribe una prueba que demuestra el incumplimiento con un perfil concreto**, con nombre explícito y
razón escrita, y el filtro que lo deja fuera de la familia general es a su vez comprobable.

| Propiedad | Método que la incumple | Dónde se demuestra |
|---|---|---|
| Monotonía (INV-40 / A-01) | `irv` | `tally-irv.test.ts` › «INV-42 — documenta positivamente la no-monotonía de IRV sin empates» |
| *Later-no-harm* | `majority-judgment` | `tally-majority-judgment.test.ts` › «documenta que MJ NO satisface later-no-harm» |
| Criterio de mayoría fuerte | `majority-judgment` | `tally-majority-judgment.test.ts` › «documenta que MJ NO satisface el criterio de mayoría fuerte» |

La no-monotonía de IRV ya estaba prevista por la especificación como anti-invariante. **Las dos de
Majority Judgment no.** Aparecieron así, y merece quedar escrito porque es el método funcionando:
**un modelo externo entregó la especificación de los métodos afirmando como invariantes que MJ
satisface *later-no-harm* y el criterio de mayoría; otro modelo, al implementarla, refutó las dos con
contraejemplos numéricos.** Si el primer documento se hubiera implementado tal cual, el arnés habría
quedado en rojo y la reparación natural —tocar el escrutinio hasta el verde— habría producido un
motor que no es Majority Judgment. Es un caso de revisión independiente funcionando, y del tipo que
`MODEL_CONTEXT.md` §4.2 describe: la salida de un revisor es una hipótesis, no autoridad.

Ninguna de las tres es un defecto del escrutinio. Ningún método basado en la mediana puede satisfacer
*later-no-harm*, y la eliminación secuencial es no monótona por construcción. Lo que sería un defecto
es que el arnés no lo supiera.

### Condorcet: el ganador se reporta, no sólo se respeta

INV-43 exige que, si existe ganador de Condorcet, gane. La spec nunca pide **reportarlo**, y sin eso
la prueba que la asamblea recibe es «camino más fuerte 143 contra 128», que no es verificable a mano.
El escrutinio publica en la `Proof` la tabla de enfrentamientos par a par y dice si hay ganador de
Condorcet o si no lo hay: «X gana uno contra uno a todas las demás» es comprobable por cualquiera con
la tabla delante; el camino más fuerte no lo es. Queda registrado como errata **E34**.

### Desempates

La cascada de desempate pasa a dieciséis reglas, las ocho originales más ocho propias de los métodos
nuevos (`higher-mean`, `fewer-zeros`, `more-fives`,
`fewer-first-preferences-in-previous-rounds`, `more-excellent`, `fewer-reject`, `more-pairwise-wins`,
`higher-min-margin`). Dos consecuencias que no son cosméticas:

- **La cascada de IRV no debe empezar por «menos primeras preferencias en rondas previas»**, porque
  en la ronda 1 no hay rondas previas y la regla es un no-op justo donde el empate es más probable
  (errata **E30**). El motor la admite en el catálogo porque sirve de la ronda 2 en adelante, pero
  ninguna configuración por defecto la propone primero: `DEFAULT_TIE_BREAK` es
  `['lexicographic-hash']`, y la última red es siempre e implícitamente ésa.
- **Toda regla que dependa de sorteo exige la semilla comprometida ya revelada.** Si no está, el
  escrutinio falla; no cae a un desempate silencioso. La spec pedía la semilla pero no la hacía
  llegar al escrutinio de los métodos que no son el sorteo (errata **E33**).

### El sorteo estratificado

El tamaño de la muestra **se acota al padrón antes de repartir**, no después: INV-55 afirmaba a la
vez `|muestra| = min(sampleSize, N)` y `Σ quota = sampleSize`, dos cosas incompatibles si
`sampleSize > N` (errata **E27**). Acotar primero las hace compatibles sin tocar ninguna de las dos.

Cuando un estrato tiene menos miembros que su cuota, la cuota se recorta a su tamaño y el faltante se
redistribuye entre los estratos que aún tienen cupo, en el orden de los restos. B.9.b mandaba
redistribuir pero su pseudocódigo nunca comparaba cuota con tamaño, así que era inimplementable tal
como estaba (errata **E28**). Si la redistribución no alcanza a completar la muestra, el escrutinio
**falla con un error tipado**; no devuelve una muestra corta como si nada.

Los suplentes son `⌈n/3⌉` **sobre el tamaño de la muestra ya acotado**, no sobre la cuota del estrato:
`n` estaba sin desambiguar en B.9.c (errata **E29**). Son los tickets siguientes de cada estrato, sin
un sorteo nuevo, para que nadie pueda repetir el sorteo hasta que salga quien le convenga.

## Alternativas consideradas

- **Punto flotante para las cuotas, como manda B.9.** Rechazada por ADR-0027. Con `sampleSize` y
  padrón pequeños el error de coma flotante casi nunca cambia el reparto, y por eso mismo sería un
  fallo silencioso: aparecería una vez, en un empate de restos, y no habría forma de explicarlo.
- **Una sola fórmula de mediana compartida por B.5 y B.7.** Rechazada: es exactamente el error E25.
  Compartir la fórmula obliga a compartir la orientación del vector, y las dos escalas se leen al
  revés en la interfaz por buenas razones de producto.
- **Marcar con `skip` las tres propiedades que fallan.** Rechazada por `TESTING.md`: un `skip` no
  distingue «esto no aplica» de «esto está roto y lo tapamos». La prueba en positivo, además, deja el
  contraejemplo escrito, que es lo que impedirá que alguien lo «arregle» dentro de un año.
- **Meter IRV en la propiedad general de monotonía y ajustar el motor.** Rechazada: produciría un
  motor que no es IRV. La no-monotonía es estructural de la eliminación secuencial.
- **Cambiar de método por defecto al descubrir que MJ incumple dos criterios clásicos.** Rechazada:
  ADR-0028 no eligió MJ por satisfacer *later-no-harm* —ningún método de mediana lo hace— sino por
  resistencia al voto estratégico y por distinguir polarización de tibieza. Un motivo nuevo tendría
  que ser un hecho nuevo, y este no lo es: era conocido en la literatura y desconocido por el
  documento que lo afirmó al revés.
- **Publicar sólo el camino más fuerte de Schulze.** Rechazada: es correcto y no es comprobable por
  la asamblea. La `Proof` existe para que un tercero rehaga la cuenta, no para exhibir el método.

## Consecuencias

- El motor ya puede ejecutar el método que ADR-0028 declara por defecto, y los otros cuatro.
- La `Proof` de cada método es reproducible con enteros: un auditor con el log y una hoja de cálculo
  llega al mismo resultado, sin depender de la aritmética de su lenguaje.
- El arnés distingue tres categorías que antes se confundían: invariante que todos cumplen,
  invariante del que un método está excluido con razón escrita, y anti-invariante demostrado con un
  perfil concreto.
- Doce defectos de la especificación quedan registrados con ficha (`E25`–`E35`, más `E24` retirada) en
  `00-contradicciones-resueltas.md`, en vez de vivir sólo en comentarios de código.

## Consecuencias negativas aceptadas

- **Cinco métodos son cinco superficies de configuración mal puesta.** La cascada de desempate, en
  particular, admite combinaciones que no fallan y no sirven —como empezar IRV por una regla que en
  la ronda 1 es un no-op—. El motor no puede prohibirlas todas sin volverse un catálogo cerrado.
- **La aritmética exacta hace el código más largo y más difícil de leer** que la versión con
  `number`. Es el costo declarado de ADR-0027 y no se negocia por legibilidad.
- **Las tres pruebas de anti-invariante son frágiles a un cambio de escala o de desempate**: usan
  perfiles concretos, y un cambio en la cascada por defecto podría hacerlas pasar por el motivo
  equivocado. Llevan escrito el razonamiento completo del contraejemplo justamente para eso.
- **La interfaz todavía no explica ninguno de los cinco.** ADR-0041 prohíbe «Condorcet», «Schulze» y
  «mediana» en pantalla, y la traducción a castellano llano de «gana quien tiene la mejor mención
  mayoritaria» está sin escribir. Hasta que exista, estos métodos no deben ofrecerse a la asamblea.
- **El sorteo sigue dependiendo de que la semilla se revele.** Si el faro externo no responde, no hay
  desempate por sorteo ni sorteo: falla, y es lo correcto, pero es un modo de fallo operativo nuevo.

## Pruebas obligatorias

- vectores de la especificación para los cinco métodos, incluidos los ejemplos numéricos verificados
  a mano en el texto;
- mediana par en las dos orientaciones: `W = 2` con `{mejor, peor}` da la peor en B.7 y la peor en
  B.5, con las dos fórmulas distintas;
- las tres pruebas positivas de anti-invariante, con su contraejemplo escrito, y la comprobación de
  que el filtro que excluye a `irv` de la familia de monotonía es explícito;
- `missingGradePolicy` en sus dos valores: `reject-ballot` descarta la papeleta entera y **no**
  imputa la peor mención a las opciones sin calificar; `worst` sí la imputa;
- `mjCompare` como preorden: antisimetría y reflexividad antes del desempate final;
- cuotas del sorteo con `sampleSize > N`, con estrato menor que su cuota, y con redistribución
  imposible;
- suplentes: son los tickets siguientes y no un sorteo nuevo;
- desempate: cada una de las dieciséis reglas por separado, la cascada agotada, y el fallo cuando una
  regla de sorteo se invoca sin semilla revelada;
- Condorcet: ganador existente reportado en la `Proof`, y ciclo sin ganador declarado como tal;
- ida y vuelta por el codec de `services/api` de **todas** las reglas de desempate y de todos los
  métodos: una configuración que el dominio acepta y el codec no puede releer es una decisión que
  muere al reconstruir el ledger;
- propiedades con `fast-check` y semilla fija sobre perfiles generados, con `irv` y
  `majority-judgment` excluidos por escrito de las familias que no cumplen.

