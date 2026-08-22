# ADR-0048: Consenso transversal como agenda, no como veredicto; y por qué ahí sí se admite punto flotante

- **Estado:** Aceptado
- **Fecha:** 2026-08-22
- **Contexto de origen:** `01-decidim-loomio-polis.md` §3; `PRODUCT.md` §4 (pantalla «Consenso»);
  ADR-0027, ADR-0038, ADR-0039, ADR-0040 y ADR-0041.

## Contexto

ADR-0038 decidió que el sondeo tipo Pol.is es **filtro de agenda y nunca decisión**, y fijó el
criterio de consenso transversal `GIC(c) = ∏_g p̂(g,c)`. Faltaba el cálculo: una matriz de personas ×
afirmaciones no dice nada por sí sola, y para descubrir en qué coinciden grupos que se oponen hay que
encontrar primero esos grupos.

Eso obliga a resolver una tensión que el proyecto no había tenido que resolver. **ADR-0027 prohíbe el
punto flotante**, y el motivo es sólido: un umbral comparado con `number` es un resultado electoral
que depende del orden de las sumas. Pero un análisis de componentes principales y un agrupamiento son
irrealizables con fracciones exactas a esta escala, y forzarlos sería sustituir un método conocido por
uno inventado para satisfacer una regla que no se escribió para este caso.

La salida fácil sería hacer una excepción y no explicarla. La salida honesta es decir **dónde está la
frontera y qué la sostiene**.

## Decisión

Un paquete nuevo, **`packages/consensus` (`@koinonia/consensus`)**, sin dependencias de runtime, que
recibe la matriz de votos trinarios y devuelve grupos de opinión, afirmaciones puente y afirmaciones
divisivas.

### La decisión central: la frontera

**Se admite punto flotante en este paquete porque su salida es agenda, no veredicto** (ADR-0038). Y
la contrapartida es una regla, no una advertencia:

> **La salida de `packages/consensus` no puede alimentar nunca una comparación de umbral ni un conteo
> de votos.**

Ni las probabilidades `p̂`, ni el `GIC`, ni las componentes, ni la pertenencia a un grupo pueden usarse
para aprobar, rechazar, ponderar, priorizar con efecto vinculante ni contar. Son insumos
descriptivos. Un grupo de opinión **no es un censo, no es un estrato del sorteo y no es un
electorado**; usarlo como tal crearía facciones formales, que es exactamente lo que ADR-0038 y
ADR-0039 prohíben.

La asimetría que hace esto sostenible ya estaba en ADR-0038: el análisis es **derivado y
recalculable** desde los votos; lo irrevocable es el acto político de congelar la agenda. Matemática
recalculable, compromiso irrevocable.

### El cálculo, y por qué cada pieza es la que es

- **PCA de 2 componentes por *power iteration* determinista**, con deflación de Hotelling para la
  segunda. El vector inicial es fijo —`1/√m` en cada posición—, no aleatorio, y el signo de cada
  autovector se **canonicaliza**: el signo de un autovector es arbitrario, así que sin canonizar dos
  ejecuciones equivalentes podrían devolver el mapa espejado. La regla es `s = Σ v_i`; si `|s|` es
  significativo, `v *= sign(s)`; si no, manda la componente de mayor magnitud, con desempate por
  índice menor.
- **k-means con inicialización *furthest-first* (Gonzalez), no k-means++.** No es una preferencia
  estadística: **k-means++ necesita un PRNG** para muestrear semillas con probabilidad proporcional a
  `D(x)²`, y este paquete no puede producir aleatoriedad ni recibirla sin volverse irreproducible.
  Gonzalez da la misma familia de garantías con una regla determinista.
- **Etiquetado estable**: al terminar Lloyd, los grupos se renumeran ordenando por la primera
  componente. Sin eso, «Grupo 1» sería un accidente del orden de inicialización y cambiaría de
  significado entre dos ejecuciones idénticas.
- **Estadísticos con suavizado de Laplace α = 1**: `p̂ = (acuerdos + 1) / (observaciones + 2)`, que
  garantiza `0 < p̂ < 1` por construcción y evita que un grupo pequeño con dos respuestas produzca un
  `0` o un `1` que dominen el producto.
- **Afirmaciones puente por `GIC(c) = ∏_g p̂(g,c)`**, sobre los grupos **con observaciones**; un grupo
  que no vio la afirmación queda fuera del producto y no puede vetarla, porque no tiene información
  con la que vetar. **Es el producto y no la media**, y ese es el punto entero: un `p̂` cercano a cero
  arrastra todo el `GIC` hacia cero, de modo que basta un grupo disidente para que la afirmación deje
  de ser puente. La media perdonaría al grupo disidente si los demás son entusiastas.
- El silencio se distingue de la ausencia: `paso` es un dato observado y `null` es «no lo vio». Los
  huecos se imputan por la media de la columna sobre las observaciones; **`paso` nunca se imputa**,
  porque la persona lo vio y eligió no pronunciarse.

### Determinismo: una parte es demostración y la otra es evidencia

Las dos invariancias de permutación no tienen el mismo estatus, y confundirlas sería vender una
garantía que no existe.

**Permutar participantes: invariancia exacta, por construcción.** Se logra con el orden en que se
canonicaliza la matriz, y el orden importa:

1. **Primero las columnas**, con una clave que **sólo lee recuentos por columna** —posturas,
   acuerdos, desacuerdos, pasos—. Un recuento es un multiconjunto, así que es invariante a permutar
   filas. Desempate final por índice de entrada.
2. **Después las filas**, comparando su contenido **ya en el orden canónico de columnas**.

Así el orden de columnas no depende de las filas, y el orden de filas depende sólo del contenido de
cada fila, no de su posición de entrada. La matriz canónica resultante es idéntica bit a bit. Hacerlo
al revés —filas primero, comparando en el orden de entrada de las columnas— haría que el orden de
filas dependiera del de columnas y la garantía se perdería. **Es una demostración, no una medición**;
la campaña de pruebas la corrobora y no la sostiene.

**Permutar afirmaciones: estable empíricamente, no garantizada.** Dos columnas que empatan en los
cuatro recuentos se desempatan **por índice de entrada**, así que permutarlas puede intercambiarlas en
el orden canónico. La matriz pasa a ser una permutación simétrica de la anterior, el producto
matriz-vector acumula en otro orden y aparecen diferencias del orden de `1e-16`. En aritmética exacta
el resultado es el mismo; en la que se ejecuta, no está demostrado que lo sea. La prueba de propiedad
lo refleja: exige que el orden entre afirmaciones con métricas **distintas** no cambie, y compara por
tramos de empate, porque exigir un orden concreto entre afirmaciones indistinguibles sería exigir que
el cálculo distinga lo que ningún dato distingue.

**Cifras verificadas hoy sobre la suite tal como queda en el repositorio:** la propiedad de
participantes corre con `numRuns: 1000` y la de afirmaciones con `numRuns: 300`, ambas con semilla
fija `20260822`, más casos estructurados de hasta 300 × 200. Las campañas más grandes que se
reportaron durante la implementación —del orden de 20 000 y 10 000 casos— **no son reproducibles
desde la suite comprometida**, así que aquí no se afirman como medición vigente.

### Abortar es un desenlace legítimo

Cuando la *power iteration* no se estabiliza dentro de su presupuesto de pasos —que es lo que ocurre
cuando la razón entre el segundo y el primer autovalor se acerca a 1—, el paquete **lanza un error
tipado (`PcaNoConvergente`) en vez de devolver un eje**. No es un defecto: **devolver un eje que los
datos no determinan sería inventarlo**, y además haría que dos ejecuciones de la misma entrada
pudieran diferir según cuántas vueltas se le dieran al cálculo, que es justo lo único que este
paquete promete.

El caso de «todo el mundo respondió igual» se distingue con un error propio, `SinVariacion`: no es un
fallo numérico —el cálculo no llegó a iterar—, es que la pregunta no tiene respuesta. Antes se
reportaba como «no convergió», lo cual era falso y mandaba a buscar el problema donde no estaba.
Tampoco se devuelven dos grupos inventados: partir en dos a personas que respondieron exactamente
igual sería fabricar un desacuerdo que no existe.

Los dos errores se exportan **como valor y no como tipo**. Estaban en un bloque `export type`, que el
compilador borra al emitir: quien importara la clase para hacer `instanceof` se encontraba con que no
existe en tiempo de ejecución. Una promesa de «error tipado, nunca un valor aproximado» sólo sirve si
quien llama puede distinguir ese error de cualquier otro.

### Sin jerga en pantalla

Cumple ADR-0041: **ninguna cadena visible dice «PCA», «k-means», «clúster», «silhouette»,
«autovector» ni «inercia»**. Los textos viven separados del cálculo, en una constante exportada para
que la capa de presentación los pruebe como literales en vez de reescribirlos. El detalle técnico de
los errores va en sus campos, no en el mensaje, porque el mensaje puede acabar en pantalla.

## Divergencias con ADR-0038, declaradas y sin resolver

ADR-0038 no se reabre aquí. Se registra que **la implementación no coincide con cinco puntos de su
sección de decisión**, para que la discrepancia esté a la vista y la decida el arquitecto, en lugar de
quedar enterrada en el código:

| ADR-0038 manda | El paquete hace |
|---|---|
| Factorización enmascarada de 2 factores, **no imputación por la media** | Imputación por la media de la columna sobre las observaciones |
| `k` por silueta **en 2..5** | `k` por silueta en `2 .. min(12, ⌊√(n/2)⌋)` |
| **Histéresis** entre snapshots, conservando el `k` anterior salvo mejora clara | Sin histéresis: no hay noción de snapshot anterior en el paquete |
| **Umbral de no-facción**: silueta máxima < ~0,25 ⇒ `FaccionesNoDetectadas` | No existe. El único desenlace sin grupos es `SinVariacion`, que es un caso distinto y mucho más estrecho |
| Filtro `z₁ > 1,2816` sobre las afirmaciones puente | No existe; el ranking sale por `GIC` sin filtro de significación |

Las tres primeras son elecciones de implementación discutibles. **Las dos últimas son huecos
funcionales:** sin umbral de no-facción, el paquete siempre encuentra grupos, incluso donde no los
hay, y la pantalla «Consenso» de `PRODUCT.md` §4 promete literalmente «no hay grupos claros» como
resultado posible. Sin el filtro de significación, una afirmación con poquísimas observaciones puede
encabezar el ranking de puentes por el suavizado de Laplace. **Hasta que se cierren, la salida no
debe presentarse a la asamblea.**

## Alternativas consideradas

- **Fracciones exactas en el análisis, para no hacer excepción a ADR-0027.** Rechazada: no es
  ejecutable a esta escala y obligaría a inventar un método distinto del que la investigación
  describe. La frontera declarada es más honesta que un algoritmo inventado para cumplir una regla.
- **Meter el análisis en `packages/domain`.** Rechazada: contaminaría con punto flotante el paquete
  donde ADR-0027 es absoluto y donde vive el escrutinio. Un paquete aparte hace que la frontera sea
  una dependencia que se ve, no una convención que se recuerda.
- **k-means++ con semilla del ledger.** Rechazada: haría al análisis dependiente de la semilla
  commit–reveal, que existe para el sorteo, y ataría una salida descriptiva a una ceremonia política.
  Gonzalez no necesita azar.
- **Emitir un resultado aproximado cuando el eje no converge.** Rechazada: dos ejecuciones de la
  misma entrada podrían diferir. Un análisis que no se puede recomputar no sirve para lo único que
  este paquete promete.
- **Colapsar `paso` y ausente en un mismo valor.** Rechazada, y es el error que ADR-0038 señala como
  el más caro de la implementación: «no lo vio» y «lo vio y no se pronunció» son hechos distintos, y
  la tasa de `paso` es la señal de que una afirmación está mal redactada.
- **Usar la media de `p̂` por grupo en vez del producto.** Rechazada por ADR-0038: la media perdona al
  grupo disidente, y el consenso transversal es precisamente lo que ningún grupo rechaza.
- **Etiquetar los grupos automáticamente.** Rechazada por ADR-0038: la etiqueta es editorial y
  humana. El paquete devuelve «Grupo 1», «Grupo 2», y nada más.

## Consecuencias

- Existe el cálculo que ADR-0038 daba por supuesto, en un paquete que se puede recomputar entero
  desde los votos y comparar contra una segunda implementación.
- El análisis es determinista y auditable: la misma matriz da la misma salida, y permutar el orden de
  llegada de las personas no cambia nada, con demostración estructural y no sólo con pruebas.
- La frontera «esto no alimenta umbrales ni conteos» queda escrita en un ADR y no sólo en un
  comentario, que es lo que permitirá rechazar la primera propuesta de usar los grupos para ponderar
  algo.
- Un grupo pequeño y coherente pesa igual que uno grande, porque el producto es ciego al tamaño.

## Consecuencias negativas aceptadas

- **La invariancia frente al orden de las afirmaciones no está garantizada**, sólo observada. Si
  alguien construye un caso con muchas columnas exactamente empatadas, puede hacerla fallar. Se
  declara en vez de presentarla como propiedad.
- **El mapa será leído como verdad** por mucha gente, como ya advertía ADR-0038. Que la salida sea
  agenda es una decisión de gobierno, no una propiedad del cálculo, y depende de que la interfaz y el
  procedimiento la sostengan.
- **Cinco divergencias con ADR-0038 quedan abiertas** (arriba), dos de ellas funcionales.
- **No hay interfaz.** La pantalla «Consenso» no existe, y con ella no existen la siembra obligatoria
  de doce afirmaciones ni la exigencia de tres contrarias a la posición de quien convoca, que en
  ADR-0038 son parte de la validez del sondeo, no adornos.
- **Nada conecta todavía este paquete con el ledger.** No hay evento de snapshot, ni
  `AgendaDeConsensoCongelada`, ni hash de entrada publicado. Mientras no exista, el análisis es una
  función que alguien ejecuta, no un hecho del que la asamblea pueda tirar.

## Pruebas obligatorias

- determinismo bit a bit sobre la misma entrada, incluida escala real de 300 × 200;
- permutación de participantes: misma persona en el mismo grupo, mismas componentes, mismo ranking; y
  si una ejecución aborta, la otra aborta con el mismo error;
- inversión completa del orden de llegada;
- permutación de afirmaciones: mismo reparto en grupos, mismas métricas, y cada métrica pegada a **su**
  afirmación —la comprobación que delata una permutación aplicada de más—;
- `0 < p̂ < 1` estricto bajo Laplace;
- el reparto en grupos es una partición: los tamaños suman el total y nadie queda en dos grupos;
- `2 ≤ k ≤ kMáximo` y `kMáximo` es el de la fórmula;
- el `GIC` es el **producto** y no la media, comprobado contra el cálculo directo, y el ranking no
  sube nunca;
- canonicalización de signo: o la suma es positiva, o manda la componente de mayor magnitud;
- matriz sin ninguna variación y matriz con columnas constantes salvo una: desenlace estable y error
  correcto de los dos posibles;
- los errores son `instanceof` en tiempo de ejecución, no sólo tipos;
- lint de interfaz: ninguna cadena exportada para pantalla contiene la jerga prohibida por ADR-0041.

