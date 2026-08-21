# ADR-0036: `Vinculo` genérico con arista nombrada como entidad de primera clase

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `01-decidim-loomio-polis.md` §1 (`Decidim::ResourceLink`); `03-deliberativa-sistemas-antipatrones.md` §5.4 (la plataforma como repositorio muerto).

## Contexto

La trazabilidad es lo que distingue una plataforma de gobernanza de un archivo. La pregunta «¿de dónde salió esta decisión?» debe tener respuesta navegable: de qué propuesta, que salió de qué encuentro, que respondía a qué problema, y qué compromiso produjo.

La solución habitual —una clave foránea ad hoc por cada par de entidades— falla de dos maneras: cada relación nueva es una migración, y las relaciones que nadie previó simplemente no existen.

## Decisión

Una entidad **`Vinculo(origen_tipo, origen_id, destino_tipo, destino_id, nombre, datos)`**: un **grafo genérico con arista nombrada**, recorrible en ambos sentidos, presente **desde el día uno**.

Nombres de arista como `propuestas_de_encuentro`, `propuestas_incluidas`, `creado_desde_borrador`, `origen_de_compromiso`. Desde un resultado se llega a las propuestas que lo originaron; desde una propuesta, al encuentro donde surgió.

El evento correspondiente es `RecursoVinculado { origen, destino, nombre }`.

La justificación de hacerlo ahora y no después: **es barato ahora e imposible de retrofitear**. Retrofitearlo significa reconstruir a mano relaciones que se perdieron porque nadie las registró cuando ocurrieron.

Regla complementaria del mismo origen: **prohibición de documentos sueltos**. Todo cuelga de un problema, una propuesta o una iniciativa.

## Alternativas consideradas

- **Claves foráneas específicas por par de entidades.** Cada relación nueva es una migración; las no previstas no existen.
- **Base de datos de grafos.** Una pieza de infraestructura más para un grafo de unos miles de aristas. Contradice ADR-0002.
- **Añadirlo cuando haga falta.** Cuando haga falta, la información de las relaciones pasadas ya se perdió.

## Consecuencias

- La pregunta «¿de dónde salió esto?» y su inversa «¿en qué acabó aquello?» tienen respuesta navegable.
- La recuperación contextual de memoria (`03-...` §3.4.4) es implementable: al escribir una propuesta nueva se pueden mostrar los aprendizajes de iniciativas vinculadas.
- El acta de un encuentro presencial queda reducida a **fuente de insumos trazables**, no a sede del gobierno: «propuestas surgidas de este encuentro» es una arista.

## Consecuencias negativas aceptadas

- **Sin integridad referencial fuerte:** la tabla polimórfica no puede tener claves foráneas reales hacia todos los tipos posibles. Un vínculo puede apuntar a algo que ya no existe, y hay que limpiarlo con un proceso propio.
- Las consultas de recorrido son más caras y menos legibles que un `JOIN` sobre una clave foránea.
- El catálogo de nombres de arista crecerá sin control salvo que se cierre como enumeración; y si se cierra, cada nombre nuevo es un despliegue. Hay que elegir y sostener la elección.
- Es fácil crear vínculos por acumulación y acabar con un grafo denso e inútil que nadie recorre.
