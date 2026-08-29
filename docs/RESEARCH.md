# RESEARCH.md — Índice de la investigación

> El pliego exige mantener un `RESEARCH.md`. No existía: la investigación vive en `docs/research/`,
> nueve ficheros —dos de ellos de más de 180 KB— escritos como insumo de diseño, no como índice.
> Este documento es el índice que falta.
>
> **No repite el contenido de `docs/research/`.** Por cada fichero dice tres cosas: qué se
> investigó, qué se decidió a partir de eso, y a qué ADR llevó la decisión. Para el argumento
> completo —tablas comparativas, fórmulas, DDL, la prosa que pesa las 180 KB— el enlace está ahí
> al lado. Quien llega debería poder saber en dos minutos qué se estudió y dónde está; quien
> necesita el detalle, seguir el enlace.
>
> **Fecha de este índice:** 2026-08-29.

## Dónde manda esto frente al resto de la documentación

`docs/research/` es **insumo, no norma** — con tres excepciones, no una. El orden de precedencia lo
fija `docs/adr/README.md` y tiene seis niveles, no cinco:

```
1. GOVERNANCE.md                      legitimidad, competencias y procedimiento
2. THREAT_MODEL.md                    adversarios y pérdidas aceptadas
3. docs/adr/                          las decisiones
4. research/30-decision-engine-spec   contrato de implementación del motor
5. research/20-normativa-datos-colombia
   research/21-normativa-udea         marco legal — vinculante en lo que afirmen SOBRE LA LEY,
                                      no sobre el diseño
6. research/01, 02, 03, 11            insumo; nunca deciden por sí solos
```

La distinción del nivel 5 importa y es fácil de perder: esos dos documentos mandan cuando dicen qué
exige la ley colombiana o la normativa de la Universidad, y no mandan cuando opinan sobre cómo
construir el producto. Un ADR puede apartarse de su criterio de diseño; no puede apartarse de la ley
que citan.

Donde un fichero de investigación contradice un ADR, **manda el ADR y se corrige la investigación**
— nunca al revés. Ese trabajo de corrección es, en buena parte, lo que contiene el fichero `00` de
abajo: no es un tema de investigación, es el registro del proceso que reconcilió los otros ocho
entre sí y contra el código que terminó escribiéndose.

## El corpus

| # | Fichero | Tamaño aprox. | En una frase |
|---|---|---:|---|
| 00 | [`00-contradicciones-resueltas.md`](research/00-contradicciones-resueltas.md) | 185 KB | No investiga un tema: reconcilia los otros ocho entre sí y contra la implementación real. |
| 01 | [`01-decidim-loomio-polis.md`](research/01-decidim-loomio-polis.md) | 28 KB | Qué mecanismos de Decidim, Loomio y Pol.is/vTaiwan resuelven un fallo real de 300 personas. |
| 02 | [`02-sociocracia-ostrom.md`](research/02-sociocracia-ostrom.md) | 29 KB | Sociocracia 3.0 y los ocho principios de Ostrom, traducidos a requisitos de software. |
| 03 | [`03-deliberativa-sistemas-antipatrones.md`](research/03-deliberativa-sistemas-antipatrones.md) | 27 KB | Minipúblicos y sorteo, sesgos de deliberación, teoría de sistemas, DAOs y evidencia de fracaso. |
| 10 | [`10-ledger-inmutable.md`](research/10-ledger-inmutable.md) | 90 KB | Diseño del historial encadenado: canonicalización, checkpoints Merkle, anclaje externo. |
| 11 | [`11-privacidad-y-voto-secreto.md`](research/11-privacidad-y-voto-secreto.md) | 56 KB | Cómo conviven el borrado de datos personales con un historial inalterable, y voto secreto verificable. |
| 20 | [`20-normativa-datos-colombia.md`](research/20-normativa-datos-colombia.md) | 78 KB | Ley 1581 de 2012 traducida a requisitos de software: principios, derechos, plazos, roles. |
| 21 | [`21-normativa-udea.md`](research/21-normativa-udea.md) | 24 KB | Naturaleza jurídica de la Universidad de Antioquia y los límites de articularse con ella. |
| 30 | [`30-decision-engine-spec.md`](research/30-decision-engine-spec.md) | 185 KB | Especificación **normativa** del motor de decisiones: tipos, escrutinio, quórum, 60 invariantes. |

Los enlaces a ADR de cada sección de abajo listan sólo los que **citan el fichero como origen** de
la decisión (verificado con `grep` sobre `docs/adr/*.md`, no por memoria). La tabla completa de los
56 ADR, con su estado y resumen, está en [`docs/adr/README.md`](adr/README.md); este índice no la
duplica.

---

## 00 — Registro de contradicciones y errores

**Qué es.** El corpus lo escribieron agentes distintos, en paralelo, sin árbitro, y se contradice a
sí mismo en puntos que no son de matiz. Este fichero documenta, para cada conflicto, qué decía cada
documento, en qué consistía el choque, cómo se resolvió y por qué. Tres partes, tres métodos
distintos de encontrar un error:

- **Parte 1 — R1, R2, R3.** Tres resoluciones **firmes** del arquitecto sobre conflictos de fondo
  entre especificaciones (no matices editoriales: la misma columna definida de dos maneras
  incompatibles).
- **Parte 2 — C4 a C20.** Diecisiete contradicciones que encontró una **revisión editorial**:
  leer el corpus y compararlo consigo mismo.
- **Parte 3 — E1 a E101 (siete rondas).** Errores que encontró **escribir el código**:
  `packages/crypto` contra la spec 10, `packages/domain` contra la spec 30 (tres rondas), el
  asistente contra la spec 03, la constitución digital contra `GOVERNANCE.md` §6, y la evaluación
  contra ADR-0053. El dato que más importa de todo el fichero: **66 errores de especificación que
  ninguna revisión por lectura detectó**, la mayoría en la spec 30 —el documento más cuidado del
  corpus—, todos silenciosos (sin excepción, sin fallo de prueba de humo). La conclusión operativa:
  *implementar temprano es una técnica de revisión, no una fase posterior.*

**Qué se decidió.**

| Resolución | Zanja | ADR que la fija |
|---|---|---|
| **R1** | El `MemberId` es **aleatorio** de 128 bits (CSPRNG), nunca derivado del documento de identidad ni del correo — anula la `DECISIÓN A.0` de la spec 30. | [0006](adr/0006-memberid-aleatorio-de-128-bits.md) |
| **R2** | Al ledger **no entra ningún hash, commitment ni derivación de un identificador personal**, con o sin sal, con o sin pepper. El ataque de diccionario sobre ~300 personas se cierra por construcción, no por dificultad computacional. | [0007](adr/0007-prohibicion-de-hashes-de-identificadores-en-el-ledger.md), [0022](adr/0022-argon2id-y-pepper-solo-dentro-del-pii-vault.md) |
| **R3** | No se apuesta jurídicamente al borrado criptográfico como equivalente de la supresión: la supresión es **`DELETE` físico + `VACUUM FULL`** en el PII Vault; el crypto-shredding se reserva a backups, donde el borrado físico es imposible. | [0009](adr/0009-borrado-fisico-en-el-pii-vault.md), [0020](adr/0020-retencion-de-35-dias-y-re-shred-en-toda-restauracion.md) |

Además de las tres resoluciones, este registro es la evidencia citada por otros ADR: **0010**
declara conscientemente la contradicción **C6** (voto seudónimo del MVP vs. el requisito de que el
vínculo voto↔votante no exista en ningún almacén); **0031** deja **C11** pendiente (el género como
estrato del sorteo es dato sensible); **0023** usa el propio hecho de que tres documentos dieran
criterios incompatibles como argumento para aplicar la lista de prohibiciones del ledger por CI en
vez de por confianza; **0047** archiva aquí sus tres anti-invariantes en vez de dejarlos sólo en
comentarios de código; **0053** remite aquí sus erratas de la séptima ronda (E95–E101); **0054**
recoge y amplía la errata **E93** (el padrón como único estado de gobierno fuera del historial
encadenado).

---

## Investigación comparada: plataformas y teoría (01, 02, 03)

Las tres comparten método: extraer **mecanismos**, no funcionalidades, y cribar contra un fallo real
de ~300 estudiantes de filosofía, no contra lo que resuelve otra escala (un municipio de 1.6M, una
cooperativa de 20, un Estado).

### 01 — Decidim, Loomio, Pol.is/vTaiwan

**Qué se investigó.** Tres plataformas de participación con arquitecturas distintas: Decidim
(espacios × componentes, versionado con diff público, enmiendas), Loomio (hilo vs. decisión,
cuatro posiciones con razón obligatoria, desenlace nominal) y Pol.is/vTaiwan (mapa de opinión sin
poder responder, consenso informado por grupos como filtro de agenda, no como veredicto).

**Qué se decidió adoptar.** La ortogonalidad Espacio × Componente con fases como ventanas de
escritura reales; un `Vinculo` genérico con arista nombrada como entidad de primera clase; respuesta
oficial obligatoria y fechada sobre toda propuesta, con desenlace nominal al cerrar una decisión;
el trinario Pol.is (acuerdo/desacuerdo/paso) con `paso` como dato observado, no como ausencia; y el
encadenamiento de vTaiwan, `Sondeo → agenda congelada → deliberación → decisión`, con el consenso
como filtro de agenda y nunca como decisión en sí. Se descarta explícitamente todo lo que es
sobrepeso de otra escala: verificación censal tipo DNI/SSO institucional, presupuestos
participativos, urna criptográfica, reacciones/`Endorsements` con peso decisorio, y el bloqueo
sociocrático como veto absoluto sin procedimiento de salida.

**A qué ADR llevó.** [0012](adr/0012-autenticacion-por-enlace-magico-al-correo-institucional.md)
(enlace mágico, no SSO institucional), [0035](adr/0035-espacio-por-componente-con-fases-como-ventanas-de-escritura.md)
(Espacio × Componente), [0036](adr/0036-vinculo-generico-con-arista-nombrada.md) (`Vínculo`
genérico), [0037](adr/0037-respuesta-y-desenlace-obligatorios.md) (respuesta y desenlace
obligatorios), [0038](adr/0038-sondeo-como-filtro-de-agenda-nunca-como-decision.md) (sondeo como
filtro de agenda), [0026](adr/0026-el-resultado-es-un-dato-derivado.md) (el conteo se materializa en
el propio evento de cierre), [0032](adr/0032-presuncion-de-validez-de-la-objecion.md) (el bloqueo sin
procedimiento es «carcelero de uno»), [0034](adr/0034-circulos-con-dominio-y-subsidiariedad-ejecutable.md)
(subsidiariedad ejecutable), [0039](adr/0039-prohibicion-de-tokens-voto-ponderado-y-reputacion.md)
(descarte de reacciones con peso decisorio).

### 02 — Sociocracia 3.0 y los principios de Ostrom

**Qué se investigó.** La diferencia operativa —no de tono— entre consenso y consentimiento, qué hace
válida a una objeción y quién la califica, el ciclo de rondas asincronizado, círculos con dominio y
delegación de autoridad, y los ocho principios de Ostrom para el manejo de bienes comunes leídos como
requisitos de software (límites claros, congruencia local, elección colectiva, monitoreo por los
propios miembros, sanciones graduadas sin gamificación, resolución de conflictos barata, derecho
mínimo a auto-organizarse, empresas anidadas).

**Qué se decidió.** El consentimiento —«¿alguien objeta con argumento?»— sustituye al consenso como
regla por defecto porque escala y el consenso no: el consenso no tiene condición de parada
verificable y termina dependiendo de que alguien declare que ya hay acuerdo. Una objeción nace
**presumida válida**; sólo un panel sorteado la desestima. Los acuerdos llevan fecha de revisión y
criterios de éxito previos, nunca a posteriori. El monitoreo (principio 4) recae sobre el recurso o
la tarea, nunca sobre la persona — de ahí la prohibición de métricas de actividad individual y de
cualquier forma de puntaje o reputación.

> **Una decisión que NO salió de acá, y conviene saberlo.** ADR-0028 (valoración por menciones como
> método por defecto) declara como contexto de origen la spec 30 §B.7 y la investigación 03, y dice
> literalmente que **contradice** a esta investigación 02 §1.5 en lo relativo a elegir personas: la
> spec declara a ese método «el único permitido» y este documento prescribe elección sociocrática sin
> candidatos. Es la contradicción **C12**, y sigue **sin resolver** — ADR-0028 no la resuelve y avisa
> de que no debe leerse como veto del procedimiento sociocrático de nominación. Atribuirle esa
> decisión a esta investigación sería contar la historia al revés.

**A qué ADR llevó.** [0025](adr/0025-padron-congelado-al-abrir-e-inmutable.md) (límites claros,
principio 1), [0032](adr/0032-presuncion-de-validez-de-la-objecion.md) (objeción presumida válida),
[0033](adr/0033-acuerdo-con-fecha-de-revision-y-criterios-previos.md) (acuerdo con fecha de
revisión), [0034](adr/0034-circulos-con-dominio-y-subsidiariedad-ejecutable.md) (círculos y
subsidiariedad, principio 8), [0035](adr/0035-espacio-por-componente-con-fases-como-ventanas-de-escritura.md),
[0040](adr/0040-prohibicion-de-metricas-de-actividad-individual.md) (principios 4 y 5),
[0053](adr/0053-evaluacion-resultado-y-aprendizajes.md), [0002](adr/0002-event-sourcing-sobre-postgresql-sin-broker.md)
(acepta el costo de migrar el bus si el proyecto federa, principio 8),
[0006](adr/0006-memberid-aleatorio-de-128-bits.md) (R1 corrige también el principio 1 de este
fichero, que asumía un `MemberId` derivado).

### 03 — Deliberación, sistemas, DAOs y antipatrones

**Qué se investigó.** Cuatro literaturas: cuándo un minipúblico sorteado de 12–20 personas supera a
una asamblea de 300 (y cuándo no); reducción de sesgos en deliberación; teoría de sistemas de Meadows
aplicada a un ciclo de aprendizaje colectivo (problema → teoría del cambio → doce puntos de
apalancamiento → cierre del bucle); una lectura escéptica de gobernanza on-chain y DAOs; y evidencia
de fracaso de plataformas participativas, cerrando en cinco métricas de salud democrática.

**Qué se decidió.** El sorteo estratificado —por mayores restos, con ticket verificable— resuelve la
varianza del sorteo simple sobre una población con jornadas desiguales. La cadena
problema→teoría-del-cambio→aprendizajes se vuelve el formulario del asistente de acción sistémica,
no un examen. Se descarta explícitamente el token de gobernanza y el voto ponderado por participación
pasada: es exactamente el mecanismo que las DAOs muestran capturable por quien más capital o más
tiempo tiene. Las cinco métricas de salud (cumplimiento de acuerdos, concentración de voz vía HHI,
cobertura por estrato, rotación del núcleo activo, razón deliberación/votación) se adoptan como
panel público, nunca como «engagement».

**A qué ADR llevó.** [0031](adr/0031-sorteo-estratificado-con-ticket-verificable.md) (sorteo
estratificado; deja abierta C11 sobre género como estrato), [0039](adr/0039-prohibicion-de-tokens-voto-ponderado-y-reputacion.md)
(lectura escéptica de DAOs, §4), [0040](adr/0040-prohibicion-de-metricas-de-actividad-individual.md)
(§3.3 y §6, las cinco métricas), [0052](adr/0052-asistente-de-accion-sistemica.md) (las 27 preguntas
del asistente, §3.1, §3.4 y §6).

---

## Diseño técnico: el historial y el voto (10, 11)

### 10 — Ledger inmutable, Merkle y anclaje externo

**Qué se investigó.** Cómo construir un historial que un administrador con acceso `root` no pueda
alterar sin que se detecte —aceptando que sí pueda destruirlo o negar el servicio—: anatomía del
evento y por qué la canonicalización JCS es imprescindible, cadena de hashes por agregado más una
espina dorsal `#ledger` con doble vínculo, el `append` seguro bajo concurrencia, checkpoints Merkle
con su cadencia, pruebas de consistencia entre checkpoints (RFC 6962), anclaje externo sin
criptomonedas, y una sección final —«Lo que este diseño NO garantiza»— con nueve límites declarados
sin adornos (no impide destrucción ni DoS, no prueba autenticidad, la ventana entre anclajes es
alterable, depende de que alguien mire, no resiste vista partida ni JavaScript servido por el propio
auditado).

**Qué se decidió.** SHA-256 sobre BLAKE3 porque está en WebCrypto y el verificador independiente
puede ser una página estática sin dependencias. Canonicalización JCS obligatoria con orden por
unidades de código UTF-16. Cadena por agregado más checkpoint Merkle global —híbrido, no uno solo—.
Triple anclaje de padrón, marcas y escrutinio antes de publicar, con anulación automática ante
cualquier discrepancia. La implementación de `packages/crypto` contra este documento encontró **seis
errores reales dentro de la propia spec** (`00-contradicciones-resueltas.md`, E1–E6 — más dos
incoherencias entre ADR y spec, E7–E8, y una divergencia elevada sin cerrar, E9), todos silenciosos;
la corrección de fondo no fue parchar cada uno sino escribir la **regla de tipos del ledger**
(§1.1-bis), que hoy gobierna todo DDL del repositorio.

**A qué ADR llevó.** [0003](adr/0003-sha-256-sobre-blake3.md), [0004](adr/0004-canonicalizacion-jcs-obligatoria.md),
[0005](adr/0005-cadena-de-hashes-por-agregado-y-checkpoint-merkle.md), [0013](adr/0013-prohibicion-estructural-de-vincular-padron-y-urna.md),
[0014](adr/0014-sin-marcas-temporales-en-la-urna-y-sellado-por-lotes.md),
[0015](adr/0015-barajado-verificable-del-escrutinio.md), [0016](adr/0016-triple-anclaje-de-padron-marcas-y-escrutinio.md),
[0017](adr/0017-declaracion-de-garantias-obligatoria.md), [0023](adr/0023-lista-de-prohibiciones-del-ledger-aplicada-por-ci.md).

### 11 — Privacidad, borrado criptográfico y voto secreto verificable

**Qué se investigó.** La tensión aparente entre «nada de lo decidido se puede alterar» y «tus datos
se borran si lo pedís»: arquitectura de dos almacenes (Ledger / PII Vault) sin llave foránea entre
ellos, crypto-shredding para backups, commitments y el ataque de diccionario sobre 300 estudiantes,
seudonimización retroactiva por eventos, y —parte 2— voto secreto verificable: Helios contra
Belenios comparados con honestidad, el problema del custodio de clave, y una recomendación por
etapas (MVP seudónimo con recibo → Belenios federado sin romper el histórico). Cierra, igual que el
10, con una lista de nueve límites que el diseño **no** resuelve —entre ellos: no hay resistencia a
coerción en ninguna etapa, y el administrador del servidor puede violar el secreto del voto en el
MVP; se declara, no se disimula.

**Qué se decidió.** La tesis central —«el conflicto es aparente, nace de meter datos personales en
el ledger»— se volvió arquitectura: dos almacenes físicamente separados, sin FK, con roles de acceso
distintos, unidos sólo por el `MemberId`. El MVP no implementa criptografía de urna: usa voto
seudónimo con tracker, delegación líquida **prohibida** en voto secreto (son incompatibles: quien
carga peso ajeno vota en acta o no hay delegación), y `VotingBackend` como puerto para poder migrar a
Belenios sin mentir sobre garantías pasadas. Esta línea sigue activa: `ADR-0056`
(`docs/adr/0056-voto-secreto-verificable.md`) es la re-evaluación de 2026, contra el estado real del
código —no contra lo que otros ADR prometen— con el hallazgo de que un servicio Belenios alojado
gratuito reduce el costo de «mantener un stack OCaml» a «sostener roles humanos», y sigue **Propuesto**.

**A qué ADR llevó.** [0006](adr/0006-memberid-aleatorio-de-128-bits.md), [0007](adr/0007-prohibicion-de-hashes-de-identificadores-en-el-ledger.md),
[0008](adr/0008-separacion-fisica-de-ledger-y-pii-vault.md), [0009](adr/0009-borrado-fisico-en-el-pii-vault.md),
[0010](adr/0010-el-mvp-no-implementa-criptografia-de-urna.md), [0011](adr/0011-votingbackend-como-puerto.md),
[0018](adr/0018-belenios-como-destino-de-la-etapa-2.md), [0019](adr/0019-custodios-3-de-5-con-perfiles-enfrentados.md),
[0020](adr/0020-retencion-de-35-dias-y-re-shred-en-toda-restauracion.md), [0021](adr/0021-seudonimizacion-retroactiva-por-eventos.md),
[0022](adr/0022-argon2id-y-pepper-solo-dentro-del-pii-vault.md), [0030](adr/0030-delegacion-prohibida-en-voto-secreto.md),
[0056](adr/0056-voto-secreto-verificable.md).

---

## Marco normativo: la ley (20, 21)

### 20 — Protección de datos personales en Colombia

**Qué se investigó.** Ley Estatutaria 1581 de 2012 y su reglamento (hoy compilado en el Decreto
1074 de 2015), traducidos artículo por artículo a requisitos de software: los ocho principios del
art. 4, cuándo la opinión política cuenta como dato **sensible**, autorización del titular, los
plazos legales exactos de consulta y reclamo, roles de Responsable/Encargado, y el conflicto duro de
§7 — supresión vs. registro inmutable — con la pregunta de si el borrado criptográfico satisface el
estándar colombiano. Cierra con una matriz de 26 requisitos legales (`RL-01`–`RL-26`), un borrador de
Política de Tratamiento y trece preguntas abiertas priorizadas para un abogado.

**Qué se decidió.** Koinonía es tratamiento regulado desde el primer registro: no hay excepción de
ámbito doméstico con ~300 titulares y publicación de resultados. La respuesta al conflicto de §7 no
es jurídica sino **arquitectónica**: si el ledger nunca contiene datos personales (R1/R2 del fichero
`00`), no hay nada que suprimir ahí, y la supresión se ejecuta íntegra en el almacén mutable
diseñado para eso (R3). Sigue habiendo zona gris real —marcada, no escondida— sobre si la
seudonimización retroactiva satisface por sí sola el art. 8 lit. e, y las trece preguntas de §8.4
siguen abiertas para un abogado.

**A qué ADR llevó.** [0001](adr/0001-monorepo-typescript-con-dominio-puro.md) (dominio puro,
arquitectura que hace posible la separación), [0006](adr/0006-memberid-aleatorio-de-128-bits.md),
[0007](adr/0007-prohibicion-de-hashes-de-identificadores-en-el-ledger.md), [0008](adr/0008-separacion-fisica-de-ledger-y-pii-vault.md),
[0009](adr/0009-borrado-fisico-en-el-pii-vault.md), [0010](adr/0010-el-mvp-no-implementa-criptografia-de-urna.md),
[0012](adr/0012-autenticacion-por-enlace-magico-al-correo-institucional.md), [0013](adr/0013-prohibicion-estructural-de-vincular-padron-y-urna.md),
[0014](adr/0014-sin-marcas-temporales-en-la-urna-y-sellado-por-lotes.md), [0015](adr/0015-barajado-verificable-del-escrutinio.md),
[0016](adr/0016-triple-anclaje-de-padron-marcas-y-escrutinio.md), [0017](adr/0017-declaracion-de-garantias-obligatoria.md),
[0018](adr/0018-belenios-como-destino-de-la-etapa-2.md), [0019](adr/0019-custodios-3-de-5-con-perfiles-enfrentados.md),
[0020](adr/0020-retencion-de-35-dias-y-re-shred-en-toda-restauracion.md), [0021](adr/0021-seudonimizacion-retroactiva-por-eventos.md),
[0022](adr/0022-argon2id-y-pepper-solo-dentro-del-pii-vault.md), [0023](adr/0023-lista-de-prohibiciones-del-ledger-aplicada-por-ci.md),
[0042](adr/0042-esal-estudiantil-como-responsable-del-tratamiento.md) (art. 6 lit. c, Responsable del
tratamiento), [0056](adr/0056-voto-secreto-verificable.md).

### 21 — Universidad de Antioquia y articulación institucional

**Qué se investigó.** Naturaleza jurídica de la UdeA como ente universitario autónomo (Ley 30 de
1992), representación estudiantil de origen legal en Consejo Superior y Consejo Académico, límites
de usar el correo `@udea.edu.co` como autenticación sin integrarse al directorio institucional, uso
del nombre e identidad de la Universidad, y tres vías reales de articulación con los canales
oficiales (derecho de petición, mandato a un representante, comunicación formal). Con la advertencia
metodológica más explícita del corpus: es el documento con mayor riesgo de alucinación, porque cita
normativa interna —acuerdos y resoluciones— que no puede verificar sin el texto a la vista.

**Qué se decidió.** Koinonía se autentica con enlace mágico al correo institucional **detrás de un
puerto**, sin asumir SSO ni APIs de la UdeA que no existen — la Universidad no decide fines ni
medios del tratamiento, así que no hay corresponsabilidad por el solo hecho de verificar un dominio
de correo. Koinonía se declara explícitamente **no** un órgano oficial de la Universidad, con
infraestructura y personería propias. Quedan doce documentos por conseguir (§6) antes de que este
fichero deje de depender de `VERIFICAR`.

**A qué ADR llevó.** [0012](adr/0012-autenticacion-por-enlace-magico-al-correo-institucional.md)
(el ADR que corrige directamente la premisa de SSO institucional que traía `01`, apoyado en el
límite que fija este fichero), [0042](adr/0042-esal-estudiantil-como-responsable-del-tratamiento.md)
(personería propia como condición de independencia frente a la Universidad).

---

## 30 — Especificación del motor de decisiones

**Qué se investigó/especificó.** No es investigación comparada: es el **contrato normativo** contra
el que se implementó `packages/domain` y contra el que corren los tests basados en propiedades
(`fast-check`). ~2600 líneas: tipos base y marcas nominales, `Electorate` congelado, unión
discriminada de métodos de decisión, papeleta polimórfica, máquina de estados con transiciones
legales y prohibidas; los nueve métodos de escrutinio completos (mayoría, supermayoría,
consentimiento sociocrático, consenso puro, puntuación, rondas con eliminación/IRV, valoración por
menciones, comparación por pares/Schulze, sorteo estratificado) con desempate determinista y sorteo
verificable commit-reveal; democracia líquida completa (tipos, resolución de ámbito, ciclos, tope de
concentración, índice HHI); quórum, ventanas temporales y cierre anticipado; y una PARTE E con 60
invariantes y 7 anti-invariantes para property-based testing.

**Qué se decidió.** Todo lo que está en el «Apéndice — Índice de decisiones normativas» del propio
documento (más de 60 decisiones con id `A.x`–`D.x`), entre ellas las que más ADR produjeron: la jerga
técnica nunca llega a la interfaz (0.A, lint), el `MemberId` es aleatorio (A.0, corregido por R1), el
padrón se congela al abrir (A.1–A.3), el resultado es siempre un dato derivado que se recomputa al
leer (A.8), la objeción nace presumida válida con panel sorteado (B.3), la aritmética es exacta —sin
punto flotante— en toda comparación de umbral (B.0.a), y la delegación cede ante el secreto del voto
(C.7). La implementación encontró **36 errores dentro de esta spec en tres rondas** (E10–E46,
`00-contradicciones-resueltas.md`) — más del doble que la spec 10, pese a ser el documento más
formalizado del corpus: la lección que deja es que ni el rigor formal sustituye a ejecutar el
contrato.

**A qué ADR llevó.** [0024](adr/0024-semilla-commit-reveal-con-faro-externo.md), [0025](adr/0025-padron-congelado-al-abrir-e-inmutable.md),
[0026](adr/0026-el-resultado-es-un-dato-derivado.md), [0027](adr/0027-aritmetica-exacta-sin-punto-flotante.md),
[0028](adr/0028-valoracion-por-menciones-como-metodo-por-defecto.md), [0029](adr/0029-delegacion-con-caducidad-y-tope-de-concentracion.md),
[0030](adr/0030-delegacion-prohibida-en-voto-secreto.md), [0031](adr/0031-sorteo-estratificado-con-ticket-verificable.md),
[0032](adr/0032-presuncion-de-validez-de-la-objecion.md), [0033](adr/0033-acuerdo-con-fecha-de-revision-y-criterios-previos.md),
[0034](adr/0034-circulos-con-dominio-y-subsidiariedad-ejecutable.md), [0035](adr/0035-espacio-por-componente-con-fases-como-ventanas-de-escritura.md),
[0036](adr/0036-vinculo-generico-con-arista-nombrada.md), [0037](adr/0037-respuesta-y-desenlace-obligatorios.md),
[0038](adr/0038-sondeo-como-filtro-de-agenda-nunca-como-decision.md), [0039](adr/0039-prohibicion-de-tokens-voto-ponderado-y-reputacion.md),
[0040](adr/0040-prohibicion-de-metricas-de-actividad-individual.md), [0041](adr/0041-prohibicion-de-jerga-tecnica-en-la-interfaz.md),
[0046](adr/0046-deliberacion-estructurada-por-etapas.md), [0047](adr/0047-metodos-de-escrutinio-completos.md),
[0048](adr/0048-consenso-transversal-como-agenda.md), [0052](adr/0052-asistente-de-accion-sistemica.md).

---

## Lo que no está en este índice

Los **ADR 0043–0045, 0049, 0051, 0053–0055** nacen directamente de `GOVERNANCE.md`, `PRODUCT.md` y
de otros ADR ya aceptados —no de un fichero nuevo de `docs/research/`— y por eso no tienen sección
propia arriba; están indexados igual en [`docs/adr/README.md`](adr/README.md), que es el registro
completo de las 56 decisiones con su estado. Ese README es también el que resuelve la trazabilidad
inversa: los dieciséis ADR con numeración propia que proponía originalmente `11` (`ADR-110`–`ADR-125`,
retirada, no usar en documentos nuevos) y a qué ADR consolidado corresponde cada uno.

## Cómo mantener esto

Este índice envejece mal solo: si aparece un fichero nuevo en `docs/research/`, o un ADR nuevo cita
uno existente como origen, la fila o la sección correspondiente de arriba queda desactualizada. La
comprobación es mecánica —`grep -l '<nombre-del-fichero>' docs/adr/*.md`, como se hizo para escribir
cada lista de ADR de este documento— y debería repetirse cuando se cierre un ADR nuevo que declare
un `docs/research/*.md` como contexto de origen.
