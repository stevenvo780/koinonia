# ADR-0038: El sondeo tipo Pol.is es filtro de agenda, nunca decisión; consenso por producto de probabilidades

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `01-decidim-loomio-polis.md` §3 (Pol.is + vTaiwan); `03-deliberativa-sistemas-antipatrones.md` §5.7.

## Contexto

Un foro clásico premia responder, y responder premia atacar: el objeto de interacción es el autor, no la población. Pol.is invierte la forma —**no se puede responder a un comentario**, sólo proponer una afirmación corta o votarla— y con eso cambia el gradiente de incentivos: frente a algo que molesta, sólo cabe votarlo en desacuerdo o **escribir otra afirmación que, para figurar, debe ganar acuerdo de gente que no piensa como uno**. El ataque personal es, estructuralmente, una afirmación que sólo aprueba el propio grupo: alto en representatividad y **cero en consenso transversal**, así que no asciende. El troleo no se censura: se vuelve irrelevante.

El riesgo, y por eso este ADR existe, es tratar el mapa resultante como un veredicto.

## Decisión

**Un módulo `Sondeo` como fase previa obligatoria** para asuntos calificados de controvertidos o con propuestas contradictorias en circulación. **Su salida es agenda, no decisión. No hay ganador en un sondeo.**

Piezas normativas:

- **Trinario** acuerdo / desacuerdo / **paso**, con `paso` tratado como **dato observado** —tasa alta de paso significa afirmación mal redactada— y `Exposicion` registrada aparte para distinguir «no lo vio» de «lo vio y pasó». Confundirlos es el error más caro de la implementación.
- **Factorización enmascarada de 2 factores**, no imputación por la media: con `n≈300` y `m≈60–150` la matriz tiene ≤45k celdas y la vía enmascarada es trivialmente costeable y no introduce sesgo contra quien votó poco.
- **`k` por silueta en 2..5**, con histéresis (semilla fija por snapshot, se conserva el `k` anterior salvo mejora clara) y **umbral de no-facción**: silueta máxima < ~0,25 ⇒ se publica `FaccionesNoDetectadas`, caso explícito y nunca ausencia de evento.
- **Consenso informado por grupos:** `GIC(c) = ∏ p̂_a(g,c)` sobre todos los grupos, con filtro `z₁ > 1.2816`. **El producto no es intercambiable por un promedio**: es un AND blando y **es ciego al tamaño del grupo**, de modo que un grupo de 18 pesa igual que uno de 180. Es la formalización operativa de «no todo se resuelve por mayoría».
- **Ruteo con prioridad** y **siembra obligatoria** de 12 afirmaciones por quien convoca, con exigencia explícita de incluir **al menos 3 contrarias a su propia posición**.
- **Snapshot inmutable y versionado** con método, semilla, hash de entrada y **varianza explicada publicada al lado del mapa**: el 2D suele explicar 20–40 % y es heurístico de lectura, no verdad geométrica.
- **Etiqueta editorial humana** de cada grupo, jamás automática, publicada junto a las afirmaciones que la sustentan.
- **Encadenamiento vTaiwan:** `Sondeo → agenda congelada → deliberación → propuesta → decisión`, con compromiso *ex ante* del órgano convocante de responder punto por punto las top-N afirmaciones de consenso.

**Asimetría que define la frontera:** los snapshots son **derivados y recalculables** desde los votos; `AgendaDeConsensoCongelada` es un **hecho político** irrevocable. Matemática recalculable, compromiso irrevocable: eso impide que quien administra el cálculo administre la política.

## Alternativas consideradas

- **Pol.is como decisor.** Convertiría un mapa heurístico con 20–40 % de varianza explicada en un veredicto.
- **Grupos con poder formal** (cuotas, veto, ponderación). Convertiría opiniones circunstanciales en facciones permanentes y crearía el incentivo a agruparse estratégicamente.
- **Mayoría simple sobre el total** en lugar del producto. Premia afirmaciones polarizantes cuando el bloque grande es suficientemente grande.
- **Imputación por la media** y clusters base de 100. Diseñados para 10⁴–10⁵ participantes; a 300 sobran y sesgan.
- **Permitir respuestas dentro del sondeo.** El voto mediría la posición de alguien *en el hilo* y no *en el tema*, y el agregado dejaría de ser interpretable. La restricción **es** el mecanismo.

## Consecuencias

- La polarización se mide antes de deliberar, y lo divisivo se excluye deliberadamente del temario de la reunión presencial: la reunión no resuelve la polarización, **opera lo acordado**.
- Una minoría coherente no puede ser ignorada por aritmética: el producto la hace pesar igual.
- El argumento largo tiene su lugar (el hilo de deliberación), y la afirmación corta el suyo (≤280 caracteres).

## Consecuencias negativas aceptadas

- **El sondeo no delibera.** No admite refutación, matiz ni evidencia. Produce un mapa, y sólo sirve encadenado.
- El mapa 2D **será leído como verdad** por mucha gente por más que se publique la varianza explicada al lado.
- Sin siembra plural y sin ruteo, la matriz es basura; ambos dependen de que quien convoca actúe de buena fe al sembrar afirmaciones contrarias a su posición.
- Con sesiones cortas (~15–20 votos por persona) la densidad será baja y los grupos, inestables entre snapshots pese a la histéresis.
