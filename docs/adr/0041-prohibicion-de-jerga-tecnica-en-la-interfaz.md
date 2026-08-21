# ADR-0041: Prohibición de jerga técnica en la interfaz, aplicada por lint

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `30-decision-engine-spec.md` §0.2 y DECISIÓN 0.A; `03-deliberativa-sistemas-antipatrones.md` §3.1 (la teoría del cambio como formulario, no como examen).

## Contexto

El objetivo político del proyecto es que 300 personas confíen en el resultado. La jerga produce sospecha de tecnocracia: en el momento en que la pantalla dice «método de Schulze» o «índice HHI», el mensaje que recibe quien lee es *este no es tu terreno y no vas a poder verificar nada*.

Es el mismo mecanismo que arruina los formularios de teoría del cambio: el léxico de la gestión de proyectos le comunica a un estudiante de filosofía que va a ser evaluado.

**El rigor va en el motor y en la `Proof`, no en el rótulo.**

## Decisión

Las palabras «Condorcet», «Schulze», «Balinski», «IRV» y «HHI» —y por extensión toda jerga equivalente— **no pueden aparecer en ningún string de `@koinonia/contracts` destinado a la interfaz**. Se prohíbe con una regla de ESLint con lista negra de términos sobre los archivos `*.i18n.ts`.

Existe una tabla de traducción normativa concepto interno → nombre visible:

| Interno | Visible |
|---|---|
| Condorcet / matriz de pares | «comparación una contra una» |
| Schulze / beatpath | «cadena de apoyos más fuerte» |
| Ciclo de Condorcet | «empate circular: A gana a B, B gana a C, C gana a A» |
| Majority Judgment | «valoración por menciones» |
| Mención mediana | «la valoración típica» |
| IRV / voto alternativo | «rondas con eliminación» |
| Papeleta agotada | «papeleta sin opciones vivas» |
| Score voting | «puntuación de 0 a 5» |
| Consentimiento sociocrático | «¿alguien objeta?» |
| Quórum de participación | «participación mínima» |
| Supermayoría | «mayoría reforzada» |
| Electorado congelado | «quiénes podían votar» |
| Sorteo estratificado | «sorteo con representación de todos los grupos» |
| Índice de concentración (HHI) | «qué tan repartida está la voz» |

La misma regla gobierna la declaración de garantías del voto (ADR-0017) y los formularios de deliberación: una pregunta por pantalla, «todavía no sé» siempre válido, y **el sistema no corrige: muestra ejemplos**.

## Alternativas consideradas

- **Jerga con glosario emergente.** El glosario lo lee quien ya sabe; para el resto, la palabra ya hizo su daño.
- **Jerga sólo en pantallas «avanzadas».** Crea dos clases de usuarios, que es exactamente la tecnocracia que se quiere evitar.
- **Guía de estilo sin verificación automática.** Se cumple hasta la primera prisa, y la primera prisa es la semana antes de la primera votación real.

## Consecuencias

- El resultado es explicable a cualquiera sin traducción intermedia, lo que es condición para que la `Proof` sirva de algo.
- La lista negra convierte una intención en un control: se rompe en el pipeline.
- Obliga a que cada método tenga un nombre común defendible **antes** de habilitarse; si no se puede nombrar en castellano llano, probablemente no debería estar.

## Consecuencias negativas aceptadas

- **Se pierde precisión terminológica** y con ella la posibilidad de que alguien busque el método por su nombre académico para estudiarlo por su cuenta. Se mitiga con documentación técnica separada, no en la interfaz.
- La lista negra es literal: producirá falsos positivos —un texto que menciona un ciclo, un nombre propio legítimo— que hay que excepcionar a mano.
- Traducir mal es peor que no traducir: «la valoración típica» para la mención mediana es aproximado y alguien objetará, con razón, que no es lo mismo.
