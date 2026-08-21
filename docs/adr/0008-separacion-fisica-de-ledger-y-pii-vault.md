# ADR-0008: Separación física de Governance Ledger y PII Vault en bases lógicas con roles distintos y sin claves foráneas

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** decisión estructural del arquitecto; consolida el **ADR-110** propuesto en `11-privacidad-y-voto-secreto.md` §1.1 y la regla dura de `20-normativa-datos-colombia.md` §7.6.

## Contexto

Koinonía promete dos cosas que parecen contradictorias: «nada de lo decidido puede alterarse» y «tus datos personales se borran si lo pedís» (art. 8 lit. e, Ley 1581). La tesis del doc 11 es que **el conflicto es aparente y nace de un error de diseño, no de la ley**: el error es meter datos personales en un registro inmutable. Si el ledger nunca los contiene, no hay nada que borrar en él y la supresión se ejecuta íntegramente en un almacén mutable diseñado para eso.

## Decisión

**Dos almacenes separados físicamente**, en bases lógicas distintas, con roles de base de datos distintos y **sin ninguna clave foránea entre ellos**:

- **Governance Ledger** — sólo `INSERT`. Eventos encadenados, `MemberId` aleatorios, padrón, resultados, `Proof`, raíces Merkle. Retención indefinida.
- **PII Vault** — relacional y mutable, con Row-Level Security. Nombre, correo, documento, programa, semestre, `consent_logs`, y el mapeo `MemberId ↔ persona`. Aquí `DELETE` es una operación normal (ADR-0009).
- **Keystore** — tercer almacén, para las claves por sujeto: su destrucción *es* parte del borrado, así que no puede vivir junto a lo que protege.

**La frontera como regla operativa:** un dato entra al Governance Ledger si y sólo si **su publicación íntegra a un desconocido no revela quién es una persona identificable**, asumiendo que ese desconocido tiene la lista pública de estudiantes del Instituto.

El único puente es el `MemberId`. Resolverlo a una persona exige un *join* aplicativo contra la bóveda, y **ese join es el único punto donde se aplica RBAC y se registra auditoría de acceso**.

## Alternativas consideradas

- **Cifrar la PII dentro del payload del evento.** El ciphertext sigue siendo dato personal mientras exista una clave, y ata el ledger al ciclo de vida de esa clave. Además convierte cada rotación en una migración del histórico.
- **Tombstones que reescriben eventos** al ejercerse la supresión. Rompe `prevHash` y con él toda la promesa de inmutabilidad.
- **Un solo esquema con permisos por tabla.** Un `GRANT` mal puesto, un superusuario o un `pg_dump` completo colapsan la separación. Los permisos son revocables; la ausencia de clave foránea y de base compartida, no.
- **Cifrado de disco (LUKS) como única medida.** Protege del robo del disco, no da granularidad por sujeto ni impide que la aplicación cruce las dos tablas.

## Consecuencias

- El `replay` del motor **nunca ve datos personales**, lo que además es coherente con la pureza del dominio (ADR-0001).
- La supresión no toca el ledger: `prevHash` verifica y la raíz Merkle anclada hace años sigue válida (ADR-0021).
- La retención puede ser asimétrica: indefinida en el ledger, corta en la bóveda y el keystore (ADR-0020).
- Un volcado completo del ledger —el escenario de filtración más probable— no expone identidades.

## Consecuencias negativas aceptadas

- **Toda vista que muestre nombres necesita un join aplicativo.** No hay `JOIN` de SQL que lo resuelva, así que hay coste de latencia, de código y de caché a invalidar cuando alguien ejerce supresión.
- No hay integridad referencial entre ledger y bóveda: un `MemberId` puede quedar huérfano y la base de datos no lo impedirá. Es deliberado —así es como funciona el borrado— pero obliga a que toda resolución de identidad **falle en abierto** hacia un seudónimo de visualización, nunca con un error.
- Dos backups, dos políticas de retención, dos procedimientos de restauración. Más superficie operativa para un equipo pequeño.
