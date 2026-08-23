# Registro de decisiones de arquitectura (ADR) — Koinonía

Un archivo por decisión, numerado correlativamente y **nunca renumerado**. Una decisión no se edita para cambiarla: se escribe una nueva y la anterior pasa a `Sustituido por ADR-NNNN`.

**Orden de precedencia normativa**, para resolver conflictos entre documentos:

1. [`../GOVERNANCE.md`](../GOVERNANCE.md): legitimidad, competencias y procedimiento.
2. [`../THREAT_MODEL.md`](../THREAT_MODEL.md): adversarios y pérdidas aceptadas.
3. Los **ADR de este directorio**. Las resoluciones R1, R2 y R3 ya están promovidas a ADR-0006,
   ADR-0007 y ADR-0009; su investigación de origen no conserva precedencia separada.
4. `30-decision-engine-spec.md` (contrato de implementación del motor).
5. `20-normativa-datos-colombia.md` y `21-normativa-udea.md` (marco legal — vinculante en lo que
   afirmen sobre la ley, no sobre el diseño).
6. Los documentos de investigación `01`, `02`, `03`, `11`.

Los ADR **0001–0012** son las decisiones estructurales del arquitecto. Los **0013–0023** consolidan los ADR propuestos en `11-privacidad-y-voto-secreto.md` (ADR-110 a ADR-125), deduplicados. Los **0024–0042** elevan decisiones arquitectónicas que estaban dispersas en el resto del corpus. Los **0043–0045** fijan los primeros incrementos de ejecución posteriores al corte vertical auditado. Los **0046–0048** cierran la deliberación estructurada, los métodos de escrutinio que faltaban y el análisis de consenso transversal. El **0049** sustituye parcialmente al 0046: retira el sellado criptográfico de la autoría y lo reemplaza por una regla de acceso con alcance de etapa. El **0050** es el primer ADR **Propuesto** —no aceptado— del registro: revisa el umbral de no-facción del 0048 y no manda hasta que se acepte. El **0051** implementa por fin la sección 6 de `GOVERNANCE.md`: las reglas de gobernanza como datos versionados que el administrador técnico no puede escribir. El **0052** cierra el principio 6 —«la IA asesora, nunca gobierna»— sacándolo de la prosa: el `AIAssistantPort` que `ARCHITECTURE.md` §6 llevaba declarado y sin implementar tiene ahora un tipo de retorno que **no puede** expresar una decisión, y las 27 preguntas del formulario funcionan sin ningún proveedor de IA. El **0053** cierra el ciclo por el otro extremo: la evaluación contra criterios que no se pueden mover, el resultado como dato derivado que se recomputa al leer y una memoria de aprendizajes sin autor, construida para que una evaluación **pueda salir mal** sin señalar a nadie.

| ADR | Título | Estado | Resumen en una línea |
|---|---|---|---|
| [0001](0001-monorepo-typescript-con-dominio-puro.md) | Monorepo TypeScript con dominio puro | Aceptado | Un solo repo; `packages/domain` sin I/O, sin reloj, sin framework, para que un tercero pueda recomputar cualquier escrutinio. |
| [0002](0002-event-sourcing-sobre-postgresql-sin-broker.md) | Event sourcing sobre PostgreSQL, sin broker | Aceptado | El estado es función del log append-only; una sola pieza de infraestructura que un equipo estudiantil pueda operar. |
| [0003](0003-sha-256-sobre-blake3.md) | SHA-256 sobre BLAKE3 | Aceptado | Se elige la función que está en WebCrypto, para que el verificador independiente sea una página estática sin dependencias. |
| [0004](0004-canonicalizacion-jcs-obligatoria.md) | Canonicalización JCS (RFC 8785) obligatoria | Aceptado | Todo hash se calcula sobre JCS con orden **por unidades de código UTF-16**; sin ella, servidor y auditor obtienen hashes distintos sin que nadie se equivoque. |
| [0005](0005-cadena-de-hashes-por-agregado-y-checkpoint-merkle.md) | Cadena por agregado + checkpoint Merkle | Aceptado | `prevHash` por agregado para verificar barato, más raíz Merkle diaria anclada fuera del servidor para que el admin no reescriba la historia. |
| [0006](0006-memberid-aleatorio-de-128-bits.md) | `MemberId` aleatorio de 128 bits (**R1**) | Aceptado | Identificador CSPRNG sin relación derivable con ningún dato personal: sin derivación no hay re-derivación, y el borrado deja de ser ficticio. |
| [0007](0007-prohibicion-de-hashes-de-identificadores-en-el-ledger.md) | Sin hashes de identificadores en el ledger (**R2**) | Aceptado | Ningún hash, HMAC ni commitment de un identificador personal entra al ledger: el diccionario sobre 300 personas muere por construcción, no por coste. |
| [0008](0008-separacion-fisica-de-ledger-y-pii-vault.md) | Separación física Ledger / PII Vault | Aceptado | Dos bases lógicas, roles distintos y ninguna clave foránea; el único puente es el `MemberId` y ese join es el punto de RBAC y auditoría. |
| [0009](0009-borrado-fisico-en-el-pii-vault.md) | Borrado físico en el PII Vault (**R3**) | Aceptado | Supresión = `DELETE` real + `VACUUM FULL`; el borrado criptográfico se reserva a backups, donde el físico es imposible. |
| [0010](0010-el-mvp-no-implementa-criptografia-de-urna.md) | El MVP no implementa criptografía de urna | Aceptado | Voto seudónimo con tracker, tablas separadas y escrutinio anclado, con los límites declarados en pantalla en vez de escondidos. |
| [0011](0011-votingbackend-como-puerto.md) | `VotingBackend` como puerto | Aceptado | Puerto con `GuaranteeMatrix` sellada en el ledger, para migrar a Belenios sin romper el histórico ni mentir sobre garantías pasadas. |
| [0012](0012-autenticacion-por-enlace-magico-al-correo-institucional.md) | Enlace mágico + `IdentityProviderAdapter` | Aceptado | Autenticación por correo `@udea.edu.co` tras un puerto; no se integra SSO institucional ni se asumen APIs de la UdeA que no existen. |
| [0013](0013-prohibicion-estructural-de-vincular-padron-y-urna.md) | Sin vínculo entre padrón y urna | Aceptado | Esquemas `roll` y `urn` sin FK, con roles distintos y test de CI que falla ante cualquier JOIN entre ellos. |
| [0014](0014-sin-marcas-temporales-en-la-urna-y-sellado-por-lotes.md) | Sin marcas temporales; lotes k=15/60 min | Aceptado | La urna no guarda tiempo y las papeletas se sellan en lotes con retardo aleatorio: con 300 votantes, la hora exacta es casi un identificador. |
| [0015](0015-barajado-verificable-del-escrutinio.md) | Barajado verificable del escrutinio | Aceptado | Orden publicado por `tracker` y permutación con la semilla commit–reveal, para que un auditor reconstruya el escrutinio bit a bit. |
| [0016](0016-triple-anclaje-de-padron-marcas-y-escrutinio.md) | Triple anclaje: padrón, marcas y escrutinio | Aceptado | Se anclan `rollRoot`, `|marcas|`, `urnRoot` y `ballotCount` antes de publicar; cualquier discrepancia anula automáticamente. |
| [0017](0017-declaracion-de-garantias-obligatoria.md) | Declaración de garantías obligatoria | Aceptado | Ninguna elección abre sin una pantalla que diga qué garantiza y qué **no**, derivada de la matriz del backend. |
| [0018](0018-belenios-como-destino-de-la-etapa-2.md) | Belenios como destino de la etapa 2 | Propuesto | Si hay criptografía de urna será Belenios federado, no Helios: cierra el relleno de urna por el propio servidor. |
| [0019](0019-custodios-3-de-5-con-perfiles-enfrentados.md) | Custodios 3-de-5 con perfiles enfrentados | Propuesto | Umbral 3 de 5 con perfiles estructuralmente opuestos, ceremonia documentada, rotación anual y sustitución por re-reparto. |
| [0020](0020-retencion-de-35-dias-y-re-shred-en-toda-restauracion.md) | Retención de 35 días y re-shred al restaurar | Aceptado | Los backups con material de clave duran 35 días y ninguna restauración acepta tráfico sin re-ejecutar las supresiones pendientes. |
| [0021](0021-seudonimizacion-retroactiva-por-eventos.md) | Seudonimización retroactiva por eventos | Aceptado | La supresión no altera eventos: se registra con `PIIErasureRequested` / `PIIErased` y la identidad falla en abierto hacia un seudónimo estable. |
| [0022](0022-argon2id-y-pepper-solo-dentro-del-pii-vault.md) | Argon2id + pepper sólo en el PII Vault | Aceptado (alcance reducido por ADR-0007) | La construcción endurecida sigue siendo correcta dentro de la bóveda; deja de ser la línea de defensa del ledger. |
| [0023](0023-lista-de-prohibiciones-del-ledger-aplicada-por-ci.md) | Prohibiciones del ledger aplicadas por CI | Aceptado | Lint sobre los tipos más test de propiedad que falla si un payload contiene un patrón de correo, cédula o IP. |
| [0024](0024-semilla-commit-reveal-con-faro-externo.md) | Semilla commit–reveal + faro externo | Aceptado | `sha256(seedAdmin ‖ faro)`: compromiso antes de abrir y faro público después de cerrar; ninguna parte determina el resultado sola. |
| [0025](0025-padron-congelado-al-abrir-e-inmutable.md) | Padrón congelado al abrir e inmutable | Aceptado | `N` fijo desde `Draft → Open`: cierra el relleno administrativo y el ataque de deserción, y hace reproducible el quórum. |
| [0026](0026-el-resultado-es-un-dato-derivado.md) | El resultado es un dato derivado | Aceptado | `ResultComputed` es proyección; la discrepancia con lo recomputado dispara anulación automática, no una alerta. |
| [0027](0027-aritmetica-exacta-sin-punto-flotante.md) | Aritmética exacta, sin punto flotante | Aceptado | Umbrales con enteros y fracciones exactas comparadas por multiplicación cruzada; el redondeo es sólo para mostrar. |
| [0028](0028-valoracion-por-menciones-como-metodo-por-defecto.md) | Valoración por menciones por defecto | Aceptado | Majority Judgment: resiste el voto estratégico, distingue polarización de tibieza y no lo mueve un bloque coordinado del 30 %. |
| [0029](0029-delegacion-con-caducidad-y-tope-de-concentracion.md) | Delegación caducable con tope de concentración | Aceptado | Democracia líquida con caducidad semestral, prevención de ciclos, tope sobre censo y `HHI*` publicado en la `Proof`. |
| [0030](0030-delegacion-prohibida-en-voto-secreto.md) | Delegación prohibida en voto secreto | Aceptado | Secreto y delegación verificable son incompatibles: el que carga peso ajeno vota en acta, o no hay delegación. |
| [0031](0031-sorteo-estratificado-con-ticket-verificable.md) | Sorteo estratificado con ticket verificable | Aceptado | Cuotas por mayores restos y selección por ticket HMAC que cada quien comprueba con una línea de comando, más suplentes publicados. |
| [0032](0032-presuncion-de-validez-de-la-objecion.md) | Presunción de validez de la objeción | Aceptado | Toda objeción nace admitida; sólo la desestima un panel sorteado por 2/3 con motivación, y el silencio favorece al objetante. |
| [0033](0033-acuerdo-con-fecha-de-revision-y-criterios-previos.md) | Acuerdo con revisión y criterios previos | Aceptado | El acuerdo es entidad aparte, con `reviewAt` y criterios obligatorios; sin renovación explícita caduca solo. |
| [0034](0034-circulos-con-dominio-y-subsidiariedad-ejecutable.md) | Círculos con subsidiariedad ejecutable | Aceptado | Dominio explícito que se sustrae del delegante, enrutador que rechaza al círculo incompetente y doble vínculo con poder de objetar. |
| [0035](0035-espacio-por-componente-con-fases-como-ventanas-de-escritura.md) | Espacio × Componente con fases | Aceptado | Ortogonalidad de Decidim, con las fases como ventanas de escritura reales: máquina de estados, no etiquetas de interfaz. |
| [0036](0036-vinculo-generico-con-arista-nombrada.md) | `Vinculo` genérico con arista nombrada | Aceptado | Grafo polimórfico recorrible en ambos sentidos desde el día uno: barato ahora, imposible de retrofitear después. |
| [0037](0037-respuesta-y-desenlace-obligatorios.md) | Respuesta y desenlace obligatorios | Aceptado | Ninguna propuesta sin respuesta escrita y fechada, ninguna decisión cerrada sin desenlace nominal; ambas deudas son públicas. |
| [0038](0038-sondeo-como-filtro-de-agenda-nunca-como-decision.md) | Sondeo como filtro de agenda | Aceptado | Pol.is produce agenda, no veredicto; consenso por producto de probabilidades, que es ciego al tamaño del grupo. |
| [0039](0039-prohibicion-de-tokens-voto-ponderado-y-reputacion.md) | Sin tokens, voto ponderado ni reputación | Aceptado | Criptografía para probar hechos, jamás para asignar poder: peso base 1 y ningún activo transferible de poder político. |
| [0040](0040-prohibicion-de-metricas-de-actividad-individual.md) | Sin métricas individuales ni gamificación | Aceptado | Se monitorea el recurso, no a las personas; el incumplimiento escala sobre la tarea y el derecho de voz es inderogable. |
| [0041](0041-prohibicion-de-jerga-tecnica-en-la-interfaz.md) | Sin jerga técnica en la interfaz | Aceptado | «Condorcet», «Schulze», «HHI» prohibidas por lint en los strings de interfaz: el rigor va en la `Proof`, no en el rótulo. |
| [0042](0042-esal-estudiantil-como-responsable-del-tratamiento.md) | ESAL estudiantil como Responsable | Propuesto | Una asociación sin ánimo de lucro es la Responsable: es la única base sólida del art. 6 lit. c para tratar datos sensibles. |
| [0043](0043-plan-de-ejecucion-congelado-e-iniciativa-atomica.md) | Plan congelado e iniciativa atómica | Aceptado | La versión incluye el plan; un resultado aprobado y su iniciativa única se escriben en el mismo commit. |
| [0044](0044-ratificacion-activa-hitos-y-ofertas-de-tarea.md) | Ratificación, hitos y ofertas de tarea | Aceptado | Ratificar activa atómicamente la iniciativa; una oferta sólo se vuelve asignación al aceptarla. |
| [0045](0045-seguimiento-capacidad-privada-y-entrega-revisable.md) | Seguimiento, capacidad privada y entrega revisable | Aceptado | Las tareas avanzan con pausas, evidencia y revisión; capacidad y supresión propia quedan privadas, autorizadas y auditables. |
| [0046](0046-deliberacion-estructurada-por-etapas.md) | Deliberación por etapas, aportes en grafo y autoría diferida | Aceptado, **parcialmente sustituido por [0049](0049-autoria-por-alcance-de-etapa.md)** | Etapas como ventanas de escritura reales, aportes tipados con aristas obligatorias y grafo acíclico por construcción; **cae** la autoría sellada (compromiso, seudónimo y etapa de revelación), **sigue** todo lo demás. |
| [0047](0047-metodos-de-escrutinio-completos.md) | Métodos de escrutinio completos | Aceptado | Puntuación, IRV, valoración por menciones, Condorcet/Schulze y sorteo estratificado, con enteros exactos y tres anti-invariantes demostrados en positivo, nunca con `skip`. |
| [0048](0048-consenso-transversal-como-agenda.md) | Consenso transversal como agenda | Aceptado | `packages/consensus` admite punto flotante porque su salida es agenda y **no puede alimentar un umbral ni un conteo**; invariancia a permutar personas demostrada, a permutar afirmaciones sólo observada. |
| [0049](0049-autoria-por-alcance-de-etapa.md) | Autoría por alcance de etapa | Aceptado | Se retira el sellado criptográfico: el autor va en el evento y lo que se deniega es **leerlo** mientras `perspectivas` siga vigente. Protege frente a los pares —también frente a quien llama a la API—, **no** frente a quien administra, y así se declara. |
| [0050](0050-umbral-de-no-faccion-revisado.md) | Umbral de no-facción revisado | **Propuesto** | Sustituiría el umbral de silueta fijo del 0048 por un contraste de hipótesis nula con **permutación determinista**. **No está aceptado ni implementado:** hasta que lo esté, manda el 0048. |
| [0051](0051-constitucion-digital-versionada.md) | Constitución digital versionada | Aceptado | Las reglas del §6 como agregado event-sourced: núcleo intangible protegido **en el pliegue** —no con tipos, que se borran al compilar—, reglas congeladas por valor en el evento que abre la reforma, caducidad que **no** degrada ningún quórum y concurrencia optimista. La aprobación 3-de-5 de Garantías **no es una firma criptográfica** y así se declara. |
| [0052](0052-asistente-de-accion-sistemica.md) | Asistente de acción sistémica y `AIAssistantPort` que no puede decidir | Aceptado | Las 27 preguntas literales de §3.1 como agregado event-sourced —sólo la 1 y la 11 obligatorias— con la frase de cierre como **función pura**; el puerto de IA devuelve un tipo incapaz de expresar una decisión o una mutación, la oferta de la máquina se registra como `system` para que nadie pueda contar rechazos ajenos, y **sin proveedor configurado el formulario funciona entero**. |
| [0053](0053-evaluacion-resultado-y-aprendizajes.md) | Evaluación contra criterios congelados, resultado derivado y memoria de aprendizajes | Aceptado | Los criterios no viven en el agregado que los evalúa: entran por una marca no serializable y el **pliegue** rechaza un log forjado aunque tenga la cadena rehecha. El desenlace no es un parámetro de ninguna orden —se recomputa al leer y la discrepancia se declara sin evento, como la caducidad del 0051—; el silencio produce `inconcluso` y nunca `logrado`, completar las tareas no declara éxito, y se cierra en fracaso con trabajo abierto. Nadie aparece en la salida: el incumplimiento escala sobre la tarea, el acuerdo o la carga, y preguntando antes de escalar. |

## Trazabilidad con los ADR propuestos en la investigación

`11-privacidad-y-voto-secreto.md` proponía dieciséis ADR con numeración propia (ADR-110 a ADR-125). Correspondencia:

| Propuesto | Consolidado en | Nota |
|---|---|---|
| ADR-110 | **ADR-0008** | Deduplicado: es la separación Ledger / PII Vault. |
| ADR-111 | **ADR-0006** | Deduplicado y promovido a resolución R1. |
| ADR-112 | **ADR-0009** | Absorbido, con alcance reducido por R3: el crypto-shredding pasa a cubrir sólo backups. |
| ADR-113 | ADR-0020 | — |
| ADR-114 | **ADR-0022** | Alcance reducido por R2: vale sólo dentro del PII Vault. |
| ADR-115 | ADR-0021 | — |
| ADR-116 | ADR-0023 | — |
| ADR-117 | **ADR-0010** | Deduplicado. |
| ADR-118 | ADR-0013 | — |
| ADR-119 | ADR-0014 | — |
| ADR-120 | ADR-0015 | — |
| ADR-121 | ADR-0016 | — |
| ADR-122 | ADR-0017 | — |
| ADR-123 | **ADR-0011** | Deduplicado: puerto + `GuaranteeMatrix`. |
| ADR-124 | ADR-0018 | — |
| ADR-125 | ADR-0019 | — |

La numeración `ADR-1xx` queda **retirada**. No debe usarse en documentos nuevos.
