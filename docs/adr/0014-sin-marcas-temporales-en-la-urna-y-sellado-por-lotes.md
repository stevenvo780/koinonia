# ADR-0014: Sin marcas temporales en la urna; sellado por lotes de k=15 o 60 minutos con retardo aleatorio

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `11-privacidad-y-voto-secreto.md` §2.6 (**ADR-119 propuesto**), ataque 4: correlación por *timing*.

## Contexto

Separar las tablas (ADR-0013) no basta. Si el padrón registra «Ana votó a las 14:32:07» y existe una papeleta insertada a las 14:32:07, están ligadas. **Con 300 votantes repartidos en varios días, la hora exacta es casi un identificador único**: a ~1,8 votos por hora, hasta truncar a la hora en punto deja conjuntos de anonimato de dos personas.

No hay parámetros canónicos publicados para esto; se derivan del tamaño del electorado.

## Decisión

Tres capas, todas obligatorias:

1. **Truncado.** `roll.voter_marks.voted_on` es de tipo `date`, **sin hora**. `urn.ballots` **no tiene ninguna columna temporal**. El escrutinio no necesita saber cuándo llegó cada voto.
2. **Lotes.** Las papeletas se retienen en un búfer y se sellan al acumular **k = 15** o al pasar **60 minutos**, lo que ocurra primero. **Ningún lote sale con menos de 5**, salvo el último, que se fusiona con el anterior si quedaría por debajo.
3. **Retardo aleatorio.** Cada papeleta espera un tiempo uniforme en **[0, 15 min]** antes de ser elegible para un lote, para que el orden interno no refleje el de llegada aunque el lote se llene rápido.

En el sobre del evento, `BallotBatchSealed` lleva `actor: 'system'` y un `occurredAt` igual al **sellado del lote**, nunca el del voto individual. Es crítico: `EventEnvelope.hash` incluye `occurredAt` y `actor`, de modo que una hora exacta o un `MemberId` ahí quedarían sellados para siempre y anclados externamente.

## Alternativas consideradas

- **Truncar a la hora en punto.** Con ~1,8 votos/hora deja conjuntos de anonimato de 2. Inútil.
- **Guardar la hora «sólo para depurar».** Los datos de depuración se filtran, se copian a un entorno de pruebas y sobreviven en un backup. Si existe, se usará.
- **Mezclar sólo al publicar**, conservando el orden real en la base. Deja el canal lateral intacto para quien tenga acceso a la base, que es el adversario declarado.
- **Lotes más grandes (k = 50).** Mejor anonimato, pero el votante esperaría horas para ver su recibo y la participación bajaría.

## Consecuencias

- El conjunto de anonimato es de 15 personas por lote: compromiso razonable para 300 votantes en 7 días.
- La correlación por *timing* deja de ser un ataque de un minuto para convertirse en un problema sin solución con los datos disponibles.
- Encaja con ADR-0015: sin tiempo y con barajado verificable dentro del lote, el orden publicado no filtra nada.

## Consecuencias negativas aceptadas

- **El votante no ve su voto reflejado al instante**: hasta 75 minutos. Hay que explicarlo en la interfaz **como característica**, no como lentitud, o se leerá como que el sistema falla.
- Si sólo votan cuatro personas, ningún lote las anonimiza. La interfaz debe **advertir** cuando la participación hace que el secreto sea nominal, y permitir anular por participación insuficiente.
- El búfer de papeletas pendientes de sellar es, mientras existe, un lugar donde el orden de llegada sí está presente. Vive en memoria y con retención mínima, pero existe.
- Perder el búfer en una caída del proceso pierde votos ya emitidos: exige persistencia transaccional del búfer, que reintroduce parte del problema y hay que diseñar con cuidado.
