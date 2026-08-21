# ADR-0031: Sorteo deliberativo estratificado con ticket HMAC verificable individualmente y suplentes publicados

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `30-decision-engine-spec.md` §B.9, DECISIONES B.9.a, B.9.b y B.9.c; `03-deliberativa-sistemas-antipatrones.md` §1.2 y §1.3. Depende de ADR-0024.

## Contexto

El sorteo es la única herramienta que rompe la autoselección: sin él, cualquier cuerpo deliberativo devuelve a los que ya están, porque los inactivos declinan más. Pero el sorteo simple sobre 300 personas da muestras con varianza brutal: si la jornada nocturna es el 20 %, la probabilidad de que salgan una o cero personas de nocturna en un comité de 15 es de ~17 %.

Y hay un problema de legitimidad que ninguna estadística resuelve: **«me tocó a mí y no a vos» se lee como dedazo** salvo que el procedimiento sea verificable por la persona misma.

## Decisión

Sorteo estratificado con tres piezas:

1. **Cuotas por mayores restos** (método de Hamilton), con desempate verificable por `hmac(semilla, "rem|estrato")`.
2. **Selección por ticket HMAC**: cada persona recibe `t = hmac(semilla, "estrato|memberId")`; se ordena por ticket y se toman los primeros `q`. **No se usa Fisher–Yates sembrado**, porque el ticket es **verificable individualmente**: cualquiera calcula su propio ticket con un comando de una línea y comprueba su posición, sin reimplementar el barajador ni confiar en el orden interno de nuestras estructuras.
3. **Suplentes publicados**: los siguientes `⌈n/3⌉` tickets de cada estrato, en orden. Si alguien declina, entra el siguiente **sin nuevo sorteo** — rehacer el sorteo ante cada declinación reabre la puerta a la manipulación por declinaciones estratégicas.

Si un estrato tiene menos miembros que su cuota, el faltante se redistribuye por el mismo criterio y **el hecho se declara en la `Proof`**: fallar en silencio produciría muestras menores que las anunciadas.

**Máximo dos ejes cruzados para n ≤ 20.** `semestre(3) × jornada(2)` ya son 6 estratos con cuotas de 2–3; un tercer eje produce cuotas de 1, y **un estrato de una persona es una anécdota con cuota**.

La semilla es la compuesta de ADR-0024.

## Alternativas consideradas

- **Sorteo simple sin estratos.** Varianza inaceptable en los ejes que importan políticamente.
- **Fisher–Yates sembrado.** Correcto, pero obliga a reproducir el algoritmo exacto y su orden de recorrido para verificar: no es auditable por alguien que no programa.
- **Rehacer el sorteo ante cada declinación.** Permite manipular el resultado declinando estratégicamente.
- **Tres o más ejes cruzados.** Fabrica la representatividad que dice medir.

## Consecuencias

- El sorteo es **verificable, no confiable**: se publican padrón, cuotas, tickets y suplentes.
- La composición del cuerpo deliberativo deja de depender de quién tiene tiempo libre y capital verbal.
- La declinación es normal y prevista, no una crisis que obligue a improvisar.

## Consecuencias negativas aceptadas

- **Elegir los ejes es una decisión política, no técnica**, y los estratos mal elegidos fabrican la representatividad que dicen medir. Debe decidirlo la asamblea **antes** del sorteo, y quedar registrado como tal.
- El eje «participación previa» es el más manipulable: se define «activo» y se define el resultado.
- El eje «género» es **dato sensible** (`03-deliberativa-sistemas-antipatrones.md` §1.2), autodeclarado y opcional, con estrato `∅` propio. Su uso como estrato choca con la prohibición de cuasi-identificadores en el ledger: **contradicción C11**, pendiente en `00-contradicciones-resueltas.md`.
- Verificar el propio ticket exige conocer el estrato al que se fue asignado, lo que empuja a publicar los estratos junto al padrón — el núcleo de la contradicción **C10**.
- La muestra pequeña sigue teniendo varianza alta en todos los atributos **no** estratificados.
