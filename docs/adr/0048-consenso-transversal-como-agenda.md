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

- **Factorización enmascarada de 2 factores** (ADR-0038), por mínimos cuadrados alternados: el
  modelo es `y_ij ≈ u_i · v_j` sobre los residuos `voto − media de la afirmación`, y **la pérdida se
  evalúa sólo sobre las celdas observadas**. El arranque son los dos ejes de una *power iteration*
  determinista sobre el segundo momento por pares completos `G_ab = Σ_{i: a y b observadas} y_ia·y_ib`;
  el vector inicial de esa iteración es fijo —`1/√m` en cada posición—, no aleatorio. El par de
  factores está determinado sólo salvo una transformación 2×2, así que se fija una parametrización
  canónica: ejes ortonormales, girados a los de mayor dispersión de las coordenadas, y con el signo
  **canonicalizado** —el signo de un eje es arbitrario, así que sin canonizar dos ejecuciones
  equivalentes podrían devolver el mapa espejado—. La regla es `s = Σ v_i`; si `|s|` es
  significativo, `v *= sign(s)`; si no, manda la componente de mayor magnitud, con desempate por
  índice menor.
- **k-means con inicialización *furthest-first* (Gonzalez), no k-means++.** No es una preferencia
  estadística: **k-means++ necesita un PRNG** para muestrear semillas con probabilidad proporcional a
  `D(x)²`, y este paquete no puede producir aleatoriedad ni recibirla sin volverse irreproducible.
  Gonzalez da la misma familia de garantías con una regla determinista.
- **Etiquetado estable**: al terminar Lloyd, los grupos se renumeran ordenando por la primera
  componente. Sin eso, «Grupo 1» sería un accidente del orden de inicialización y cambiaría de
  significado entre dos ejecuciones idénticas.
- **`k` por silueta en 2..5** y **umbral de no-facción**, los dos de ADR-0038. El tope de 5 no es
  estadístico: por encima de cinco, un mapa de facciones deja de ser legible, y este análisis existe
  para que alguien lo lea. Por debajo del umbral no se publican grupos: se publica
  `FaccionesNoDetectadas`, que es un **desenlace normal y no un error**, y por eso viaja como
  variante de una unión discriminada —con un campo opcional se podría ignorar; así el compilador
  obliga a contemplarlo—. Sin facciones se sigue publicando el consenso: la población entera es el
  único grupo y el `GIC` sobre ese grupo único es el acuerdo general.
- **Histéresis entre instantáneas** (ADR-0038): con la instantánea anterior delante se conserva el
  `k` anterior salvo mejora clara de la separación, y los grupos **heredan su numeración** por
  emparejamiento con los centros anteriores. Lo segundo no es un adorno de lo primero: la numeración
  por defecto ordena los grupos por su primera coordenada, así que un desplazamiento mínimo que cruce
  dos centros los intercambia de nombre y el mapa parece haber cambiado cuando no ha cambiado nada.
  ADR-0038 pide además «semilla fija por snapshot»; aquí **no hay semilla en absoluto**, que es una
  garantía estrictamente más fuerte. La instantánea entra y sale como dato: el paquete no guarda
  estado.
- **Estadísticos con suavizado de Laplace α = 1**: `p̂ = (acuerdos + 1) / (observaciones + 2)`, que
  garantiza `0 < p̂ < 1` por construcción y evita que un grupo pequeño con dos respuestas produzca un
  `0` o un `1` que dominen el producto.
- **Afirmaciones puente por `GIC(c) = ∏_g p̂(g,c)`**, sobre los grupos **con observaciones**; un grupo
  que no vio la afirmación queda fuera del producto y no puede vetarla, porque no tiene información
  con la que vetar. **Es el producto y no la media**, y ese es el punto entero: un `p̂` cercano a cero
  arrastra todo el `GIC` hacia cero, de modo que basta un grupo disidente para que la afirmación deje
  de ser puente. La media perdonaría al grupo disidente si los demás son entusiastas.
- **Filtro de significación `z₁ > 1,2816`** (ADR-0038), con `z₁ = 2·√n_v·(p̂ − 0,5)` y exigido en
  **todos** los grupos que observaron la afirmación. El suavizado de Laplace mantiene `p̂` lejos de
  los extremos pero no dice nada del tamaño de la muestra: tres acuerdos de tres dan `p̂ = 0,8`,
  y sin filtro una afirmación que vieron seis personas encabeza la lista por delante de una que
  votaron doscientas. Esa lista es la que ADR-0038 convierte en agenda congelada de la asamblea. Se
  publican las dos: la lista **filtrada**, que es la que va a pantalla, y la **tabla completa** con
  el `GIC`, el `z₁` mínimo y si cumple el filtro, para que quien recompute vea también lo descartado.
- El silencio se distingue de la ausencia: `paso` es un dato observado y `null` es «no lo vio». La
  celda ausente **no se imputa**: queda fuera de la máscara y por tanto fuera de la pérdida. `paso`
  entra en la máscara como observación de pleno derecho, porque la persona lo vio y eligió no
  pronunciarse.

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

## Divergencias con ADR-0038: las cinco, cerradas

Las cinco divergencias que este ADR declaró abiertas **se han cerrado corrigiendo el paquete**. La
regla de precedencia del proyecto es `GOVERNANCE.md → THREAT_MODEL.md → docs/adr/ → research/`, así
que manda ADR-0038 y se corrige el código: **ADR-0038 no se ha tocado**.

| ADR-0038 manda | Qué hacía el paquete | Qué hace ahora |
|---|---|---|
| Factorización enmascarada de 2 factores, **no imputación por la media** | Rellenaba cada hueco con la media de la columna y proyectaba la fila entera | Mínimos cuadrados alternados sobre las celdas **observadas**; el hueco no recibe valor (`src/factorizacion.ts`) |
| `k` por silueta **en 2..5** | `2 .. min(12, ⌊√(n/2)⌋)` | `2 .. min(5, ⌊√(n/2)⌋)` |
| **Histéresis** entre snapshots, conservando el `k` anterior salvo mejora clara | No existía la noción de instantánea anterior | `opciones.anterior` conserva el `k` salvo mejora clara y hace **heredar la numeración** de los grupos |
| **Umbral de no-facción**: silueta máxima < ~0,25 ⇒ `FaccionesNoDetectadas` | No existía; siempre se publicaban grupos | Desenlace `FaccionesNoDetectadas` como variante del resultado, con el acuerdo general publicado |
| Filtro `z₁ > 1,2816` sobre las afirmaciones puente | No existía | `z₁ = 2·√n_v·(p̂ − 0,5)` exigido en todos los grupos con observaciones |

**El determinismo sobrevive intacto**, que era la condición de todo el cambio. La invariancia frente
a permutar participantes sigue siendo **exacta y por construcción**: la factorización enmascarada
opera sobre la matriz canónica, que es idéntica bit a bit bajo cualquier permutación de filas, y
todo lo que se ajusta después es una función de esa matriz y de nada más. Las pruebas de propiedad de
`test/props/determinismo.test.ts` siguen en verde, con `numRuns: 1000` en la de participantes, y se
han **reforzado**: ahora exigen además que el propio *desenlace* —grupos, «no hay grupos claros» o
fallo tipado— no dependa del orden de llegada, en vez de saltarse el caso sin comprobar nada.

### El sesgo que la máscara quita, medido

Es la razón por la que ADR-0038 pide la vía enmascarada («no introduce sesgo contra quien votó
poco»). Sobre `matrizConFacciones(60, 24, 3, ·)`, borrando votos a una misma persona y midiendo
cuánto se encoge su distancia al centro del mapa (mediana sobre 40 semillas):

| Vota | Con imputación por la media | Con factorización enmascarada |
|---|---|---|
| 75 % | 0,759 | 1,011 |
| 50 % | 0,498 | 1,044 |
| 25 % | 0,269 | 1,368 |

La imputación encogía la posición de cada quien **exactamente a la fracción que había votado**: no
era un detalle numérico, era una penalización silenciosa a quien menos participa, que lo empujaba
hacia el grupo del centro. La máscara quita el sesgo; **no quita la incertidumbre**, y la fila del
25 % lo enseña: con pocos votos la estimación es legítimamente más ruidosa.

## Un hallazgo que ADR-0038 tendrá que decidir: el umbral de 0,25 casi nunca se alcanza

El umbral de no-facción está implementado **tal como lo escribe ADR-0038** (`< ~0,25`), y esa cifra
no se ha cambiado: un ADR no se reabre desde el código. Pero al implementarlo se midió, y el
resultado hay que dejarlo escrito porque afecta a lo que la pantalla puede llegar a decir.

Sobre **3 000 matrices sin facciones** —ruido simétrico, acuerdo dominante, continuo de opinión en
una y en dos dimensiones latentes, y densidades del 10 % al 100 %, con `n` de 30 a 300—
**ninguna** bajó de 0,25; el mínimo observado fue 0,2794. La causa es estructural, no del código: la
silueta media del mejor `k-means` sobre una nube de dos dimensiones sin estructura ronda 0,35, y
tomar el **máximo sobre `k ∈ 2..5`** eleva todavía más ese suelo. El umbral queda por debajo del
suelo del propio estadístico.

Dónde sí se alcanza: cuando `⌊√(n/2)⌋ < 3`, es decir con **17 participantes o menos**, sólo se
examina `k = 2` y el suelo baja; ahí el ruido cae por debajo de 0,25 en torno al 10 % de los casos.
Por eso las pruebas del umbral usan asambleas pequeñas: son las únicas en las que la regla, tal
como está escrita, se activa.

**Consecuencia práctica, sin adornos:** con un sondeo del tamaño para el que se diseñó el módulo
(`n ≈ 300`), `FaccionesNoDetectadas` no se emitirá casi nunca, y la promesa de `PRODUCT.md` §4 de
que la pantalla pueda decir «no hay grupos claros» sigue siendo, en la práctica, inalcanzable. El
mecanismo existe, está probado y funciona; lo que no discrimina es el número. **Corregirlo exige un
ADR nuevo que revise el umbral de ADR-0038** —o que lo sustituya por un criterio con un suelo
conocido, como comparar la silueta observada contra la que da una permutación aleatoria de los mismos
votos—. No se ha hecho aquí porque no es una decisión que corresponda tomar al implementar.

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
- **El umbral de no-facción de ADR-0038 no discrimina a la escala prevista** (arriba, con la
  medición). El mecanismo está y funciona; el número necesita un ADR nuevo.
- **La máscara quita el sesgo pero sube la varianza.** Quien vota poco ya no es arrastrado al centro,
  pero su posición es más incierta y puede caer en el grupo equivocado. Es el intercambio que ADR-0038
  elige, y conviene saber que es un intercambio: sobre datos con dos facciones y ruido, quien emitió
  sólo 3 votos cae en su bloque el 72 % de las veces con máscara y el 82 % con imputación.
  La compensación que la investigación describe —un mínimo de ~7 votos para entrar al agrupamiento,
  que `PRODUCT.md` §4 ya promete como «todavía no podemos ubicarte en el mapa»— **no está
  implementada** y no es competencia de este ADR.
- **El margen de la histéresis lo fija la implementación, no el ADR.** ADR-0038 exige conservar el
  `k` anterior «salvo mejora clara» y no dice cuánta. Se ha declarado 0,05 sobre una escala de −1 a 1,
  en un solo sitio y con su razón escrita.
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
- `2 ≤ k ≤ kMáximo`, `kMáximo` es el de la fórmula y nunca pasa de 5;
- el `GIC` es el **producto** y no la media, comprobado contra el cálculo directo, y el ranking no
  sube nunca;
- la pérdida de la factorización se evalúa **sólo sobre lo observado**: el residuo de cada persona es
  perpendicular a los ejes en sus celdas votadas y **no** lo es si se cuentan también los huecos —el
  contraste que separa la máscara de la imputación—;
- borrar votos a una persona no encoge su posición hacia el centro del mapa;
- una entrada sin facciones reales produce `FaccionesNoDetectadas`, y la persona lee literalmente
  **«No hay grupos claros»**; una entrada con dos bloques nítidos sigue encontrando los dos grupos;
- el filtro `z₁` deja fuera la afirmación de mayor `GIC` cuando la vieron seis personas, y la tabla
  completa la sigue mostrando con su `z₁` para poder auditar el descarte;
- histéresis: dos instantáneas sucesivas con un cambio pequeño no cambian el número de grupos ni
  renumeran a nadie, y la histéresis **cede** cuando la estructura cambia de verdad;
- canonicalización de signo: o la suma es positiva, o manda la componente de mayor magnitud;
- matriz sin ninguna variación y matriz con columnas constantes salvo una: desenlace estable y error
  correcto de los dos posibles;
- los errores son `instanceof` en tiempo de ejecución, no sólo tipos;
- lint de interfaz: ninguna cadena exportada para pantalla contiene la jerga prohibida por ADR-0041.

