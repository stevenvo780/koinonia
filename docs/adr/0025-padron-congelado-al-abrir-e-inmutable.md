# ADR-0025: El padrón se congela en `Draft → Open` y es inmutable durante toda la votación

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `30-decision-engine-spec.md` §A.2.1, DECISIONES A.1, A.2 y A.3; `02-sociocracia-ostrom.md`, principio 1 de Ostrom (límites claros).

## Contexto

«¿Quiénes podían votar?» parece una pregunta administrativa y es la más política del sistema. Si el padrón se mueve durante la votación, el quórum deja de ser una proposición con valor de verdad hasta que cierra, y un mismo conjunto de votos puede pasar y luego fallar.

Hay además dos ataques concretos que un padrón móvil habilita: el **relleno administrativo** (matricular aliados cuando ya se conoce el marcador parcial) y la **deserción** (una minoría que va perdiendo se retira en masa para tumbar el quórum o vaciar el numerador). El segundo es real en asambleas estudiantiles.

## Decisión

El padrón se congela en la transición `Draft → Open` y es **inmutable**. Se publica `rollHash` al abrir; cualquiera verifica que el conteo se hizo sobre exactamente ese conjunto.

Tres reglas derivadas:

- **A.1** — quien se matricula **después** de `frozenAt` no vota en esa decisión, aunque la ventana siga abierta.
- **A.2** — quien se retira o pierde la matrícula **después de haber votado**: su voto **cuenta**, y además sigue contando en el denominador `N`. La legitimidad de un acto se juzga por las condiciones del momento del acto (*tempus regit actum*).
- **A.3** — quien se retira **sin** haber votado no vota, pero **permanece en `N`**: su ausencia se computa como no participación.

Una prórroga por falta de quórum **no reabre el padrón** (spec 30 D.2.b).

El caso «votó alguien que suplantó una identidad» o «un expulsado por fraude» **no** se resuelve por la vía del retiro, sino con el evento excepcional `BallotVoided`, que exige motivación escrita, firma de dos miembros del círculo de garantías y queda en el log como acto público y recurrible. **Anular un voto es un acto político visible, no un efecto colateral de una baja administrativa.**

## Alternativas consideradas

- **Padrón vivo, evaluado al cierre.** Denominadores móviles, quórum indecidible durante la ventana y ataque de deserción abierto.
- **Padrón vivo sólo para altas** (nadie sale, todos los nuevos entran). Cierra la deserción y deja abierto el relleno administrativo, que es el peor de los dos.
- **Recongelar en cada prórroga.** Convierte la prórroga en una herramienta para cambiar el electorado a mitad de partido.

## Consecuencias

- Los denominadores son estables: `N` fijo, quórum y supermayoría sobre censo bien definidos, y el resultado es una **función del log**, reproducible.
- Auditoría posible: `rollHash` publicado al abrir permite comprobar el conjunto exacto.
- Los dos ataques —relleno y deserción— quedan cerrados por diseño, no por vigilancia.

## Consecuencias negativas aceptadas

- **Se excluye a quien se matricula durante la ventana.** Es una injusticia real, no un tecnicismo. Se compensa con **ventanas cortas** (72 h por defecto) y con `Decision.recurrence` para decisiones periódicas.
- El voto de alguien que ya no pertenece al Instituto sigue contando. Es contraintuitivo y habrá que explicarlo cada vez.
- Alguien que se retiró sin votar sigue inflando el denominador, lo que hace más difícil alcanzar quórum. Es deliberado: la alternativa permitiría fabricar quórum reduciendo `N`.
