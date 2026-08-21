# Koinonía

Plataforma open source de gobernanza colectiva para el estudiantado del Instituto de Filosofía de la Universidad de Antioquia.

Estado: en construcción. Ver `docs/` para producto, gobernanza, arquitectura, modelo de amenazas y estrategia de pruebas.

## Estructura

| Ruta                 | Qué es                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `packages/crypto`    | Canonicalización JCS, SHA-256, cadena de eventos y árbol Merkle. Sin dependencias de runtime. |
| `packages/domain`    | Dominio puro: sin I/O, sin reloj, sin aleatoriedad (ADR-0001).                                |
| `packages/contracts` | Tipos y textos de frontera.                                                                   |
| `services/api`       | Adaptadores: ledger sobre PostgreSQL, proyecciones. Lo único que hace I/O.                    |
| `apps/web`           | Interfaz.                                                                                     |
| `tests/`             | Integración y extremo a extremo, fuera de los paquetes.                                       |
| `infra/docker`       | PostgreSQL de desarrollo, para levantar la base a mano.                                       |
| `docs/`              | Investigación, ADR, producto y gobernanza.                                                    |

La dirección de dependencia se verifica en CI (`scripts/check-domain-purity.mjs`), no en revisión de
código.

## Requisitos

Node 22 (`.nvmrc`) y pnpm. `corepack enable` basta.

## Comandos

```sh
pnpm install
pnpm run typecheck   # tsc estricto sobre fuentes y pruebas
pnpm run lint        # eslint + prettier + pureza del dominio
pnpm run test        # vitest (unitarias y property-based con fast-check)
pnpm run test:watch
pnpm run build       # tsc --build con project references
pnpm run verify      # typecheck + lint + test
```

## Pruebas de integración del ledger

`tests/integration/` corre contra **PostgreSQL real**, levantado con Testcontainers. No hay ni un
doble de la base: todo lo que esas pruebas comprueban es comportamiento de PostgreSQL —que `uuid`
devuelve la forma con guiones, que `jsonb` reordena las claves, que un trigger `ENABLE ALWAYS`
sobrevive a `session_replication_role`—, y un mock reproduciría exactamente aquello en lo que ya
creíamos.

Si Docker no está disponible, las suites se **saltan** con el motivo escrito en el nombre del bloque,
para que quede en la salida y nadie confunda «no corrió» con «pasó». Para que eso sea un fallo y no
un salto —en CI lo es— se usa `KOINONIA_REQUIRE_DOCKER=1`. Para levantar la base a mano:

```sh
docker compose -f infra/docker/docker-compose.yml up -d
```

Las migraciones son SQL plano numerado en `services/api/migrations/`, aplicadas por un runner propio
que registra el hash de cada fichero: editar una migración ya aplicada deja de ser invisible.

## Licencia

AGPL-3.0-or-later. Es una plataforma de gobernanza autoalojable: si alguien la modifica y la despliega
como servicio, las modificaciones vuelven a la comunidad que la usa. Ver `LICENSE`.
