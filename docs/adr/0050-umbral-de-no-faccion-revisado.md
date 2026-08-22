# ADR-0050: Umbral de no-facción revisado mediante contraste de hipótesis nula por permutación determinista

- **Estado:** Propuesto
- **Fecha:** 2026-08-22
- **Contexto de origen:** `docs/adr/0038-sondeo-como-filtro-de-agenda-nunca-como-decision.md` §21 y `docs/adr/0048-consenso-transversal-como-agenda.md` §74.

## Contexto

El documento ADR-0038 definió un umbral absoluto de no-facción: si la silueta máxima de los agrupamientos candidatos es inferior a un valor aproximado de $0.25$, se debe publicar el resultado `FaccionesNoDetectadas` en lugar de una división en grupos de opinión. Esta especificación responde a un requerimiento de diseño (`docs/PRODUCT.md` §4), el cual promete que la pantalla «Consenso» pueda reflejar de forma explícita que «no hay grupos claros». Presentar agrupamientos artificiales donde no existe una estructura real de opinión es un comportamiento no deseado para el sistema.

Sin embargo, el umbral absoluto seleccionado no cumple con su función de discriminación y los análisis empíricos realizados lo confirman:
- Se evaluó el umbral sobre 3000 matrices que carecían de estructura de facciones reales. Las pruebas incluyeron ruido simétrico, escenarios de acuerdo dominante, continuos de opinión en una y dos dimensiones latentes, densidades de respuesta de entre el 10 % y el 100 %, y volúmenes de participantes que variaron de 30 a 300.
- En ninguna de las simulaciones el valor de la silueta máxima bajó de $0.25$. El valor mínimo registrado fue de $0.2794$.
- Se reconstruyó la implementación previa de la biblioteca y se verificó que el comportamiento es consistente, lo que demuestra que esta limitación no obedece a la implementación actual en el paquete `@koinonia/consensus`.

La causa de este comportamiento es de índole matemática y estructural, no algorítmica. La silueta promedio esperada de aplicar un agrupamiento de k-means óptimo sobre una nube de puntos bidimensional sin estructura alguna se ubica en los siguientes valores teóricos:
- Distribución gaussiana: $0.350$
- Distribución en disco: $0.393$
- Distribución en cuadrado: $0.399$
- Segmento unidimensional: $0.585$

Dado que el algoritmo evalúa múltiples candidatos de $k$ y selecciona la silueta máxima obtenida en el rango de búsqueda, el valor mínimo esperado del estadístico se eleva aún más. Por lo tanto, el umbral fijo de $0.25$ se encuentra sistemáticamente por debajo del suelo matemático del estadístico bajo la hipótesis de ausencia de estructura.

El umbral actual solo logra activarse en casos límite con 17 participantes o menos. En este rango, el número máximo de grupos candidatos se limita a $k=2$, lo que disminuye el suelo del estadístico de silueta y permite que el ruido caiga por debajo de $0.25$ en cerca del 10 % de las corridas. Este fenómeno explica por qué las pruebas del umbral en la suite de pruebas del proyecto utilizan asambleas de tamaño reducido, pues son las únicas condiciones bajo las cuales la regla actual se activa.

**Consecuencia práctica:** Para una deliberación nominal con aproximadamente 300 participantes (el tamaño para el cual fue diseñado el módulo), la condición `FaccionesNoDetectadas` no se emitirá prácticamente nunca. La promesa técnica de `docs/PRODUCT.md` §4 es, bajo las reglas vigentes, inalcanzable a escala real. El mecanismo del código es correcto, pero el parámetro constante no es funcional.

## Decisión

Se propone reemplazar el umbral absoluto constante por un **contraste de hipótesis nula mediante permutaciones**.

### Definición del contraste
Para determinar la existencia de facciones significativas, la silueta máxima observada en la matriz de votación original se comparará contra la distribución de siluetas máximas que resulta de aplicar el análisis sobre matrices permutadas de la misma deliberación.
- La permutación destruye la estructura de correlación entre los participantes al barajar las respuestas, pero conserva los totales de acuerdo, desacuerdo y paso de cada afirmación individual (las distribuciones marginales por columna).
- Se declarará la presencia de facciones si y solo si la silueta máxima observada supera un percentil alto de la distribución de permutaciones (por ejemplo, el percentil 95). En caso contrario, el sistema publicará el resultado `FaccionesNoDetectadas`.

Este método permite que el suelo de la silueta deje de ser una constante arbitraria y se calcule a partir de las propiedades específicas de los datos de cada consulta (número de participantes, densidad de respuesta y variabilidad de las afirmaciones).

### Criterios técnicos de diseño

#### 1. Determinismo estricto sin `Math.random()`
El linter del paquete prohíbe el uso de `Math.random()` para garantizar la reproducibilidad y la auditoría externa de los resultados del escrutinio. Se propone la siguiente estrategia determinista para la generación de las permutaciones:
- **Semilla base:** La semilla inicial del generador se derivará directamente del hash de entrada del snapshot inmutable de los votos (definido en ADR-0038).
- **Generador pseudoaleatorio determinista (PRNG):** Se implementará un PRNG de software de libre distribución y fácil portabilidad (por ejemplo, LCG o Mulberry32) integrado directamente en el paquete.
- **Barajado determinista:** Para cada una de las $N$ permutaciones, el generador se inicializará combinando la semilla base con el índice de la corrida de permutación. Las columnas de la matriz de votos se barajarán de forma independiente utilizando el algoritmo de Fisher-Yates alimentado por este flujo determinista.

#### 2. Costo computacional y tamaño de muestra ($N$)
La incorporación del contraste incrementa el número de ejecuciones del pipeline de agrupamiento ($k$-means y factorización) de una a $1 + N$ veces.
- Se propone un valor de **$N = 99$**. Este tamaño de muestra permite definir el percentil 95 con resolución matemática suficiente (la silueta observada debe ser estrictamente mayor que al menos 95 de las 99 siluetas simuladas para rechazar la hipótesis nula, lo que corresponde a un nivel de significancia de $\alpha = 0.05$).
- **Estimación de costo:** El tiempo de ejecución exacto para el análisis determinista en el servidor de producción no está verificado. Sin embargo, con base en la eficiencia observada del algoritmo Lloyd determinista y la factorización enmascarada para una matriz nominal de $300 \times 100$, el tiempo estimado por corrida es inferior a $10\text{ ms}$. De este modo, realizar $99$ evaluaciones adicionales requiere un tiempo total estimado de procesamiento inferior a $1\text{ segundo}$. Dado que este cálculo se ejecuta de forma asíncrona al momento de emitir un snapshot inmutable y no en la ruta crítica del registro de votos, este costo adicional es aceptable.

#### 3. Casos límite con pocos participantes
En deliberaciones con baja participación (17 participantes o menos), el contraste se adapta de forma natural a la escasez de datos:
- Si el tamaño de la matriz restringe la cantidad de configuraciones únicas posibles o eleva la varianza de la silueta bajo la hipótesis nula, la distribución de permutaciones reflejará esto ampliando sus umbrales empíricos, reduciendo el riesgo de falsos positivos de facciones.
- El costo computacional total en estos escenarios no está verificado con precisión de microsegundos, pero se estima despreciable (inferior a $5\text{ ms}$).

### Modificación del estándar ADR-0038
De ser aceptado, este ADR reemplazará la siguiente sección de la decisión del **ADR-0038**:
> *«... y umbral de no-facción: silueta máxima < ~0,25 ⇒ se publica FaccionesNoDetectadas»*

Dicha regla será sustituida en su totalidad por el contraste por permutación detallado en el presente documento.

**Hasta que la propuesta no sea formalmente aprobada por el comité, el umbral absoluto de $0.25$ del ADR-0038 se mantendrá vigente**, con las limitaciones de discriminación documentadas en este archivo.

## Alternativas consideradas

- **Elevar el umbral absoluto a un valor superior (como $0.35$ o $0.40$):** Rechazada. Ninguna constante es adecuada para todos los tamaños de asamblea. Un valor fijo más alto provocaría falsos negativos en asambleas pequeñas y no resolvería las diferencias causadas por los cambios en la densidad de las matrices.
- **Aproximación analítica de la distribución de siluetas:** Rechazada. Estimar la distribución teórica de la silueta máxima bajo Lloyd y la inicialización de Gonzalez sobre matrices con datos ausentes (bajo máscara) es matemáticamente complejo. La simulación empírica por permutación es conceptualmente simple, exacta y auditable.
- **Permutar filas (participantes) en lugar de celdas por columna:** Rechazada. La permutación de filas preserva las correlaciones internas del voto de cada individuo, impidiendo la destrucción de la estructura grupal que define la hipótesis nula.

## Consecuencias

- Se posibilita que el sistema declare formalmente que «no hay grupos claros» en asambleas de escala real ($n \approx 300$), cumpliendo la promesa de `docs/PRODUCT.md` §4.
- La frontera de decisión se ajusta de manera automática a la escala, densidad de votación y características de los datos de la deliberación.
- Se mantiene el determinismo estricto e independiente de la plataforma para la verificación del cálculo por terceros.

## Consecuencias negativas aceptadas

- **Aumento del tiempo de cómputo:** El procesamiento pasa de ser casi instantáneo a tomar menos de un segundo en matrices de tamaño nominal.
- **Mayor complejidad de implementación:** Exige la incorporación de código propio para el PRNG y el algoritmo de barajado en `packages/consensus`, incrementando el esfuerzo de mantenimiento del paquete.

## Pruebas obligatorias

- **Determinismo estricto de permutaciones:** Ante la misma matriz de entrada y la misma semilla, el generador debe producir exactamente las mismas matrices permutadas.
- **Preservación marginal:** Cada columna de la matriz permutada debe contener el mismo número exacto de acuerdos, desacuerdos y pasos que la columna correspondiente de la matriz original.
- **Validación del generador:** El PRNG de software no debe hacer uso de `Math.random()` ni de funciones de fecha del sistema.
- **Efectividad en datos estructurados:** El test debe detectar consistentemente la presencia de facciones en conjuntos de datos sintéticos con dos o más bloques claramente delimitados (silueta observada > percentil 95).
- **Efectividad en datos no estructurados:** El test debe clasificar como `FaccionesNoDetectadas` las matrices que contengan únicamente ruido homogéneo simétrico.
- **Costo computacional acotado:** La ejecución del contraste con $N = 99$ permutaciones en una matriz de $300 \times 100$ debe requerir menos de $1.5\text{ segundos}$ en el entorno de pruebas.
