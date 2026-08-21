# ADR-0035: Ortogonalidad Espacio × Componente, con las fases como ventanas de escritura

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `01-decidim-loomio-polis.md` §1 (Decidim: espacios de participación y componentes); `02-sociocracia-ostrom.md` §1.3 (capacidades restringidas por fase); `03-deliberativa-sistemas-antipatrones.md` §1.4.

## Contexto

El aporte conceptual real de Decidim no es su catálogo de funcionalidades sino la **ortogonalidad entre dos planos**: el espacio, que define *quién* participa y *bajo qué reglas*, y el componente, que aporta *qué se puede hacer*. Esa separación es lo que permite que «proceso de reforma del plan de estudios» y «asamblea permanente» reutilicen el mismo motor con reglas distintas.

Sin ella, cada nuevo tipo de proceso es código nuevo, y la comunidad no puede crear espacios sin pasar por el equipo técnico — lo que viola el principio 3 de Ostrom (arreglos de elección colectiva).

## Decisión

Dos entidades ortogonales:

- **`Espacio`** (`proceso | asamblea | iniciativa`) — contenedor con legitimidad y ciclo de vida propios, con `Fase`s ordenadas de las cuales exactamente una está activa.
- **`Componente`** — instancia configurable (permisos, ventana de apertura, límites, `ajustes` por fase — `jsonb` en la proyección, **`text` canónico en el evento**; ver consecuencias) enchufable en cualquier espacio. **Todo contenido cuelga de un componente, nunca del espacio.**

Y una regla que es la que hace el trabajo:

**Las fases no son etiquetas de interfaz: son ventanas de escritura.** Qué componentes están abiertos depende de la fase activa, y el sistema **no permite** actos de una fase en otra. Es una máquina de estados, no una recomendación pedagógica. Así se materializa la separación entre deliberar, decidir y ejecutar, y así se implementan las fases del ciclo de consentimiento (`02-...` §1.3) y de la sesión deliberativa asíncrona (`03-...` §1.4).

`FaseActivada { fase_id, cierra_componentes[], abre_componentes[] }` es un evento del ledger.

## Alternativas consideradas

- **Una entidad monolítica «proceso» con funcionalidades fijas.** Cada tipo nuevo de proceso exige código nuevo y despliegue; la comunidad queda dependiendo del equipo técnico para ejercer el principio 3 de Ostrom.
- **Contenido colgando del espacio en lugar del componente.** Impide tener dos instancias del mismo mecanismo con reglas distintas en el mismo espacio.
- **Fases como etiquetas informativas.** Es lo que hace casi todo el mundo, y produce el resultado conocido: se vota mientras se delibera, y el primero que propone fija el marco.
- **Multi-tenancy (`Organization` de Decidim).** Descartada: un solo Instituto. Contamina cada consulta y cada índice.

## Consecuencias

- Un mismo motor sirve para la asamblea permanente, un proceso de reforma y una iniciativa nacida desde abajo, con reglas distintas y sin código nuevo.
- La compuerta de deliberación es ejecutable: no se puede votar sin haber pasado por la fase previa, que es la contramedida al antipatrón de captura organizada (`03-...` §5.7).
- Cambiar las reglas de un espacio es un acto de gobierno registrado, no una migración.

## Consecuencias negativas aceptadas

- **Indirección conceptual:** «componente» es un concepto que hay que explicar y que no significa nada para quien entra por primera vez. En la interfaz nunca debe aparecer esa palabra (ADR-0041).
- La configuración por fase multiplica los estados posibles y con ellos los casos de prueba y los modos de configurar mal un espacio.
- Una máquina de estados estricta produce situaciones frustrantes y legítimas: alguien llega tarde con un aporte valioso y el sistema lo rechaza. Se acepta; la alternativa es que no haya fases.
- El `ajustes jsonb` es una puerta abierta a meter estructura sin esquema. Necesita validación por tipo de componente o se convertirá en un basurero.
- **`ajustes` es `jsonb` sólo mientras viva en la proyección.** En el momento en que la configuración de un componente entre al `payload` de un evento del ledger —y `FaseActivada` ya lo hace con `abre_componentes[]`—, ese valor cae bajo la **regla de tipos del ledger** (`10-ledger-inmutable.md` §1.1-bis) y **no puede almacenarse en `jsonb`**: ese tipo reordena las claves y destruiría la canonicalización JCS del evento. La forma autoritativa es el texto canónico en `text`; el `jsonb` queda como copia derivada y no autoritativa para consultar. Es la misma trampa que la spec 10 tenía en su propio DDL y que sólo se vio al implementar.
