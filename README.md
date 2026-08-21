# Koinonía

Plataforma open source de gobernanza colectiva para el estudiantado del Instituto de Filosofía de la Universidad de Antioquia.

Estado: en construcción. Ver `docs/` para producto, gobernanza, arquitectura, modelo de amenazas y estrategia de pruebas.

## Estructura

| Ruta                 | Qué es                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `packages/crypto`    | Canonicalización JCS, SHA-256, cadena de eventos y árbol Merkle. Sin dependencias de runtime. |
| `packages/domain`    | Dominio puro: sin I/O, sin reloj, sin aleatoriedad (ADR-0001).                                |
| `packages/contracts` | Tipos y textos de frontera.                                                                   |
| `services/api`       | Adaptadores: persistencia, HTTP, correo. Lo único que hace I/O.                               |
| `apps/web`           | Interfaz.                                                                                     |
| `tests/`             | Integración y extremo a extremo, fuera de los paquetes.                                       |
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

## Licencia

AGPL-3.0-or-later. Es una plataforma de gobernanza autoalojable: si alguien la modifica y la despliega
como servicio, las modificaciones vuelven a la comunidad que la usa. Ver `LICENSE`.
