# ADR-0001: Monorepo TypeScript con dominio puro sin dependencias de framework

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** decisión estructural del arquitecto; consistente con `30-decision-engine-spec.md` §0.1 (ámbito: función pura, sin I/O, sin reloj, sin dependencias de framework) y con la estructura ya presente en el repositorio (`packages/domain`, `packages/crypto`, `packages/contracts`, `apps/web`, `services/api`).

## Contexto

Koinonía tiene una obligación poco habitual para una aplicación de este tamaño: **el resultado de una decisión debe ser reproducible por un tercero, bit a bit, durante años**. Un estudiante que audite una votación de 2026 en 2031 debe poder recomputar el escrutinio y obtener el mismo hash. Esa exigencia no la cumple un motor que vive dentro de un controlador HTTP, que lee el reloj del sistema, que depende de la versión de un ORM o de la locale del proceso.

Al mismo tiempo el proyecto lo sostiene un equipo estudiantil pequeño, con rotación anual del ~20 % (`03-deliberativa-sistemas-antipatrones.md` §3.3) y bus factor bajo. Un repositorio por servicio multiplicaría el coste de coordinación, la deriva de versiones entre contratos y el número de pipelines que alguien tiene que saber operar.

## Decisión

Un **único repositorio** con espacios de trabajo de TypeScript y una regla de dependencia estricta:

- `packages/domain` — el modelo de dominio y el `DecisionEngine`. **Cero dependencias de tiempo de ejecución** salvo la biblioteca estándar. Prohibido: acceso a red o disco, `Date.now()`, `Math.random()`, `localeCompare`, punto flotante en comparaciones de umbral, importar cualquier cosa de `apps/`, `services/` o de un framework.
- `packages/contracts` — tipos y textos de frontera (DTO, eventos, cadenas de interfaz). Depende de `domain`; nadie depende de `apps/`.
- `packages/crypto` — canonicalización, hashing, cadena de eventos, Merkle. Depende sólo de `domain`.
- `services/api` — adaptadores: persistencia, HTTP, correo, KMS. Es el único que hace I/O.
- `apps/web` — interfaz.
- `tests/` — integración y extremo a extremo, fuera de los paquetes.

El tiempo y la aleatoriedad **entran como datos** (instantes y semillas), nunca como efectos. La dirección de dependencia se verifica en CI, no en revisión de código.

## Alternativas consideradas

- **Repositorios separados por servicio.** Coordinar un cambio de contrato exigiría tres PR sincronizados en tres repos; con un equipo que rota cada año, garantiza deriva de versiones.
- **Aplicación monolítica sin separación de paquetes** (todo en `services/api`). Es lo más rápido de arrancar y lo que hace imposible el objetivo central: un verificador independiente tendría que arrastrar el servidor entero, con su base de datos, para recomputar un escrutinio.
- **Dominio en un lenguaje distinto** (Rust/OCaml) por rigor. Ningún estudiante de filosofía que quiera leer el motor lo leería, y el proyecto perdería a sus propios auditores. La auditabilidad por humanos no técnicos es un principio de diseño (spec 30 §0.1.2), no un adorno.

## Consecuencias

- El `DecisionEngine` se puede publicar como paquete autónomo y ejecutarse en el navegador, en un script de auditoría o en un verificador de terceros.
- Los property-based tests (fast-check) corren contra el dominio sin levantar infraestructura, lo que hace viable el umbral de `numRuns ≥ 1000` de la spec 30 §E.8.
- Un solo pipeline de CI, un solo esquema de versiones, un solo lugar donde mirar la historia.
- La regla de dependencia hace visible cualquier intento de meter I/O en el dominio: aparece como un error de compilación, no como una discusión.

## Consecuencias negativas aceptadas

- El monorepo crece y los tiempos de CI con él; hará falta caché e invalidación por paquete antes de lo que parece.
- La pureza obliga a inyectar el instante y la semilla en cada llamada, lo que hace las firmas más ruidosas y la primera lectura del código menos cómoda.
- Escalar equipos independientes es más difícil: cualquiera puede tocar cualquier paquete. A 300 personas y ~5 mantenedores esto no es un problema; a otra escala lo sería.
