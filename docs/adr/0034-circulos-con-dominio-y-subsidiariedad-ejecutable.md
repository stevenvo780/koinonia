# ADR-0034: Círculos con dominio explícito, subsidiariedad ejecutable y doble vínculo

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `02-sociocracia-ostrom.md` §1.4 y principio 8 de Ostrom (empresas anidadas / gobernanza policéntrica).

## Contexto

Trescientas personas no deliberan como un cuerpo único. Una asamblea de 300 tiene tiempo de palabra tendiendo a cero (90 minutos son 18 segundos por persona), se autoselecciona hacia quien tiene tiempo libre y capital verbal, y polariza hacia el extremo de la mediana previa (`03-deliberativa-sistemas-antipatrones.md` §1.1).

Pero descentralizar en subgrupos sin reglas produce el problema opuesto: doble jurisdicción, conflictos irresolubles y captura del subgrupo por quien controla el flujo de información hacia arriba.

## Decisión

Un **círculo** es la tupla `(driver, dominio, miembros, acuerdos)`. El **dominio** es la lista explícita de materias sobre las que decide **sin consultar**, más sus límites (techo presupuestal, horizonte, población afectada).

- **El dominio delegado se sustrae del delegante, no se duplica.** Si el círculo padre delega «programación del coloquio», deja de decidirlo. Duplicarlo produce doble jurisdicción.
- **Subsidiariedad ejecutable:** el enrutador resuelve el círculo competente a partir del dominio y **rechaza** abrir la decisión en un círculo incompetente, proponiendo el correcto. No es una recomendación pedagógica: es una validación.
- **Colisión de dominios:** se abre driver en el ancestro común, que asigna la materia y lo registra como acuerdo con fecha de revisión (ADR-0033).
- **Doble vínculo:** dos personas —una elegida por el círculo hacia arriba, otra designada por el superior hacia abajo— participan **con plena capacidad de objetar en ambos círculos**. Esto (i) impide que la información suba filtrada por una sola persona, que es el modo estándar de captura jerárquica; (ii) convierte la voz del círculo inferior en **poder de bloqueo** dentro del superior, no en «derecho a ser escuchado»; (iii) sustituye la relación de reporte por membresía recíproca.
- **Tope de dos enlaces simultáneos por persona**, para que la red no se concentre en los mismos cinco nombres.
- El modelo **no asume un único cuerpo raíz**, de modo que federar con otros estamentos no exija rediseño.

## Alternativas consideradas

- **Asamblea única.** Maximiza legitimidad de input y minimiza calidad epistémica; a 300 personas no delibera, vota por señal de tribu.
- **Subgrupos con quórum propio anidados dentro de un hilo** (modelo Loomio). Descartado en `01-decidim-loomio-polis.md` §2: si aparece un subcuerpo se modela como espacio con sus reglas, no como jerarquía dentro de una conversación.
- **Jerarquía con reporte en lugar de doble vínculo.** Es exactamente el mecanismo por el que una jerarquía captura a sus subordinados: una sola persona controla lo que sube.
- **Dominio como texto libre sin enrutador.** Cada propuesta acaba donde su autor quiere, que es donde cree que va a ganar.

## Consecuencias

- Decide el círculo más pequeño cuyo dominio contenga la materia, lo que reduce la carga sobre la asamblea y acelera el ciclo.
- La competencia de cada círculo es explícita y verificable, no una costumbre.
- El doble vínculo da al círculo inferior poder real dentro del superior.
- La federación futura no exige rediseñar el modelo.

## Consecuencias negativas aceptadas

- **Coste de roles:** dos personas por enlace; con 8–12 círculos son ~20 roles que llenar en una comunidad donde el voluntariado es escaso y rota cada año.
- La definición operativa de «materia» dentro de un dominio sigue siendo **texto libre**; debería ser una taxonomía cerrada compartida con la del doc 01. Está declarado como abierto en `02-sociocracia-ostrom.md` y sigue abierto.
- El enrutador que rechaza decisiones mal ubicadas será vivido como burocracia por quien sólo quiere proponer algo.
- El protocolo de federación del principio 8 no está definido; el modelo lo permite pero nadie lo ha diseñado.
