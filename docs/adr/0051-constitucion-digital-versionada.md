# ADR-0051: La constitución digital es un agregado event-sourced con el núcleo intangible protegido en el pliegue

- **Estado:** Aceptado
- **Fecha:** 2026-08-22
- **Contexto de origen:** `GOVERNANCE.md` §4 (filas 13 y 14), §6 completo, §7 (límites del
  administrador técnico) y §10; ADR-0001 (dominio puro), ADR-0004 (canonicalización JCS), ADR-0016
  (triple anclaje), ADR-0025 (padrón congelado), ADR-0027 (aritmética exacta);
  `THREAT_MODEL.md` adversario nº 2.

## Contexto

`GOVERNANCE.md` §6 dice que los métodos, umbrales, quórums, plazos, dominios y límites del
administrador **no son opciones de un panel**: son acuerdos versionados dentro de la plataforma, con
la decisión que los creó, su motivo y su fecha de revisión, y **el administrador técnico no puede
escribirlos**. Hasta esta entrega esa sección no tenía una línea de código: los umbrales vivían en
`DecisionConfig`, que cualquiera con acceso al servidor podía escribir sin dejar más rastro que un
`UPDATE`.

Reformar exige, según la fila 13: 21 días de deliberación, 100 personas en voto directo, 200 votos a
favor de 300, 14 días de espera, ratificación publicada y **3 de 5** firmas del Círculo de
Garantías. La fila 14 sube a 225 de 300 **en dos votaciones separadas por un semestre** y 4 de 5. Y
el §6 cierra con tres cláusulas de atrincheramiento —doble llave temporal, núcleo intangible y
prohibición de reformar en ventana propia— más una cláusula de caducidad fundacional a los doce
meses.

El adversario es el nº 2 del modelo de amenaza: **quien administra el servidor**. No entra por la
API; entra con un historial completo traído de fuera —una restauración, un volcado— con todos los
hashes recalculados. Cualquier protección que sólo viva en las órdenes es, frente a él, decorativa.

## Decisión

**Un agregado `Constitution` event-sourced, encadenado como los demás, con seis tipos de evento y dos
máquinas de estados.** Vive en `packages/domain/src/constitution/`. Las cinco decisiones que lo
definen:

### (a) El núcleo intangible NO se protege con tipos: se protege en el pliegue

Se rechaza modelar los seis puntos del §6.b como una unión literal de TypeScript. **Los tipos se
borran al compilar**: no rechazan un solo evento en tiempo de ejecución, y no sobreviven a un log
traído de fuera, que es exactamente el vector del administrador.

En su lugar, el núcleo es **un conjunto de hashes fijado en el evento fundacional** —`core:
readonly {clauseId, textHash}[]`, los seis puntos exactos del §6.b— y `applyConstitution` lo
**recomputa desde el texto vigente en cada evento** y lo compara con el del génesis. Si difiere,
lanza `CoreAlteredError`. La comprobación corre al final de **todos** los eventos, incluidos los que
no tocan el texto, porque su valor no es cubrir los caminos que hoy existen sino que **no haya
ningún camino** —tampoco el que alguien añada mañana— que deje el núcleo alterado y el historial
plegable.

La comparación es sobre la **preimagen canónica completa** (`canonicalEquals`, que es `jcs(a) ===
jcs(b)`), no campo a campo: un campo que alguien añada a `Clause` en el futuro queda cubierto sin
que nadie tenga que acordarse de compararlo. Y es **síncrona**, que es la razón de comparar la
preimagen en vez del hash: SHA-256 en este proyecto es WebCrypto y por tanto asíncrono (ADR-0003), y
un pliegue asíncrono habría sido el precio de una garantía idéntica —`jcs(a) === jcs(b)` implica
`sha256(jcs(a)) === sha256(jcs(b))`, y sin colisiones que discutir—.

**El límite, declarado:** el pliegue compara contra el génesis; si alguien reescribe el evento
fundacional **entero** —núcleo y texto a la vez—, el historial es coherente consigo mismo y se
pliega. Eso lo cubre `constitutionCoreHash`, el hash publicable del núcleo, cotejado en
`verifyConstitutionLog(log, { expectedCoreHash })` contra un valor que vive **fuera** del servidor:
publicado y anclado con quórum 2-de-3 (ADR-0016). Las dos capas están probadas, incluida la que
falla.

**Ni la refundación cambia el núcleo.** `assertSameCore` obliga a que toda fundación posterior
declare el núcleo idéntico al del génesis. Si no fuera así, dejar caducar la constitución sería la
vía barata para vaciarlo, y la caducidad volvería a ser lo que no debe ser: una puerta trasera con
paciencia. Cambiar el núcleo es empezar **otra comunidad, con otro historial**, que es literalmente
lo que dice el §6.b: «no es reformar, es fundar otra cosa».

### (b) La prohibición de reformar en ventana propia se implementa congelando las reglas por valor

`ReformOpened` lleva dentro `FrozenReformRules`: los umbrales, el censo, el Círculo de Garantías y el
calendario **copiados por valor** tal como estaban al abrir. Todo lo que juzga a la reforma se lee de
ahí y **nunca** de las reglas vigentes. Es el patrón del padrón congelado de ADR-0025 aplicado a la
regla en vez de al censo, y cierra la trampa evidente: una reforma no puede cambiar las reglas de su
propia aprobación.

Una copia que nadie coteja se puede inventar, así que el pliegue comprueba **dos** cosas y hacen
falta las dos: al abrir, que la copia coincida exactamente con las reglas vigentes
(`FROZEN_RULES_MISMATCH`); después, que todo se juzgue contra la copia. La primera la hace honesta;
la segunda, útil.

Además se implementa la regla **literal** del §6.c, que es más amplia que lo anterior: la votación de
una reforma no puede caer en los 30 días anteriores a una decisión ya convocada que dependa de una
cláusula que la reforma toca, ni en las dos últimas semanas del semestre. El calendario también va
congelado en la apertura; leer el calendario vivo permitiría abrir la veda desconvocando una
decisión.

### (c) La aprobación M-de-N **no está asegurada criptográficamente**, y se declara

**Nada impide que quien administra el servidor fabrique las tres aprobaciones de Garantías.**
`ReformApprovedByGuarantor` es un evento del ledger cuyo `guarantorId` tiene que coincidir con el
`actor` del sobre; eso ata la aprobación a una identidad **dentro del sistema**, no a una llave que
sólo esa persona tenga. Firmar de verdad exige criptografía asimétrica, y ADR-0001 prohíbe
dependencias de tiempo de ejecución en `packages/domain` —que es la condición de que el verificador
independiente sea una página estática—.

El §7 dice que el administrador «no puede firmar la puesta en vigor de una reforma». Eso es hoy una
**prohibición normativa sin barrera técnica**, y así está escrito en el código.

Lo que sí hay es **detección**: las aprobaciones son eventos del historial encadenado, el historial se
ancla fuera con quórum 2-de-3, una aprobación fabricada queda anclada con fecha y autor, y la persona
a la que se le atribuyó puede repudiarla en público señalando el evento exacto. Es la estrategia
declarada del proyecto frente al adversario nº 2: no se le impide mentir, se hace imposible que
mienta sin dejar rastro. **La interfaz no puede llamar «firma» a esto sin decirlo**, igual que C6
obliga a declarar lo que el secreto del voto no da.

### (d) La caducidad NO degrada el quórum

Se rechaza la propuesta de que, pasados 30 días sin refundar, las reglas caigan a mayoría simple. Eso
es una puerta trasera perfecta: a una minoría organizada le bastaría con dejar pasar el plazo para
gobernar con la mitad de los votos que hoy necesita.

Al caducar, el sistema entra en un estado **declarado y público** —`statusAt(state, at) ===
'caducada'`, con `constitutionNotice` diciéndolo en castellano llano— en el que **sólo se acepta un
tipo de evento: la refundación**, y con la regla fundacional íntegra, sin rebajar nada. Si nadie
refunda, no pasa nada: un colectivo inactivo se queda **sin reglas**, que es un hecho público y
reversible, y no gobernado por una minoría activa.

La caducidad se evalúa de forma **perezosa** contra el `Instant` que entra como dato en cada orden.
No hay evento `ConstitutionExpired` y no hay reloj en el dominio: si la caducidad exigiera que
alguien escribiera «ha caducado», la constitución seguiría vigente mientras nadie se acordara, que es
justo al revés de lo que un plazo significa.

Los meses se suman en el **calendario civil de Bogotá**, con aritmética entera (`addMonths`, sobre los
algoritmos de Hinnant que ya usa `window.ts`), no en milisegundos: «doce meses» es una unidad del
calendario de la asamblea. Una fundación el 14 de noviembre de 2023 caduca el 14 de noviembre de
2024, que son **366** días porque 2024 es bisiesto.

### (e) Control de concurrencia optimista

`ReformOpened` declara la `targetVersion` sobre la que se abre, y `ReformRatified` comprueba que esa
versión **siga siendo la vigente**. Dos reformas abiertas sobre la versión 3 pueden votarse las dos;
ratificarse, sólo una. La segunda se cae con `STALE_REFORM_TARGET` y se cierra en público con el
motivo `version_desplazada`. Sin esto, la segunda ratificación construiría su versión sobre un texto
que nadie votó: el suyo, ignorando lo que la primera cambió.

### Lo que se rechaza explícitamente

**Cualquier vía rápida en la que un modelo de lenguaje decida si un cambio es «sólo sintáctico».**
Viola el principio 6 del proyecto —la IA asesora, nunca gobierna—. No está implementada y no se
propone. Un cambio de coma que un clasificador considere cosmético es indistinguible, para el
sistema, de una reforma: por eso toda reforma pasa por el mismo procedimiento, y el diff se publica
(`diffTexts`) para que lo juzguen personas.

## Modelo

Seis eventos: `ConstitutionFounded`, `ReformOpened`, `ReformVoteRecorded`,
`ReformApprovedByGuarantor`, `ReformRatified`, `ReformRejected`.

**Una cláusula es `(clauseId, textHash)`.** El texto normativo vive fuera —es `GOVERNANCE.md`, que se
publica— y entra por su hash. El dominio no interpreta prosa, y una cláusula que sólo existe como
hash no se puede reescribir «arreglando una coma» sin que el hash cambie y el pliegue lo vea. Aparte
de las cláusulas, la versión lleva en forma estructurada los **requisitos de reforma**, que son las
únicas reglas que este agregado tiene que aplicar y no sólo conservar.

**Este agregado no cuenta votos.** El escrutinio es del motor de decisiones; aquí entra como dato
—`votesInFavor`, `directParticipation` y el `decisionId` que permite recomputarlo— y lo que se
comprueba es que alcance el umbral de la copia congelada, con multiplicación cruzada de `bigint`
(ADR-0027): 2/3 sobre 300 son **200 exactas** y 199 no valen.

**Cerrar una reforma exige un hecho que lo sostenga.** Los cinco motivos de `ReformRejected` son
comprobables contra el historial y el pliegue los comprueba. Sin eso, quien facilita podría matar una
reforma ganadora escribiendo «no alcanzó el umbral»: el motivo publicado sería mentira comprobable,
pero la reforma estaría igual de muerta.

**Se conservan todas las versiones.** `state.versions` nunca se poda: el §6.5 exige publicar
«versión, fecha y diferencia respecto de la anterior», y una diferencia contra algo que ya no existe
no se puede comprobar.

## Qué protege esto y qué NO

- **Protege frente a la reescritura silenciosa del núcleo**, incluso con la cadena de hashes
  recalculada. Probado fabricando exactamente ese historial.
- **No protege del génesis reescrito entero** sin el hash del núcleo anclado fuera. Con él, sí.
- **No protege de una aprobación de Garantías fabricada** por quien administra. Detecta, no previene.
- **No comprueba que el calendario congelado sea verdadero.** Una reforma que declare una lista vacía
  de decisiones convocadas pasa la veda del §6.c. El calendario es un hecho público del ledger y
  verificarlo es lo que el §6.6 le encarga a Garantías.
- **No suspende el resto de la plataforma al caducar.** El §6 dice que «todo se suspende salvo
  lectura y exportación». El dominio ofrece `assertConstitutionVigent(state, at)`, pero **nadie la
  llama todavía**: engancharla en `engine.ts`, en las iniciativas y en la capa de servicio es deuda
  declarada de esta entrega, no un hecho.

## Alternativas consideradas

- **Modelar el núcleo con tipos de TypeScript.** Rechazada: se borran al compilar y no rechazan un
  log traído de fuera. Ver (a).
- **Hashear el núcleo dentro del pliegue.** Habría obligado a un `applyConstitution` asíncrono, por
  WebCrypto, a cambio de una garantía idéntica a la de comparar preimágenes canónicas. Rechazada.
- **Degradar el quórum al caducar.** Rechazada: es una vía de captura para quien tenga paciencia.
  Ver (d).
- **Permitir que la refundación fije un núcleo nuevo.** Rechazada por lo mismo: haría de la caducidad
  la vía barata para vaciar el núcleo. Cambiar el núcleo exige otro historial.
- **Un clasificador que decida si un cambio es cosmético.** Rechazada por el principio 6. No se
  implementa ni se propone.
- **Guardar el texto normativo en el dominio.** Rechazada: el dominio no interpreta prosa, el texto
  se publica, y guardar texto y hash a la vez añade una forma de mentir —declarar un hash que no
  corresponde al texto— sin añadir ninguna garantía.

## Consecuencias

- `packages/domain` gana un agregado de ~1 700 líneas y seis acciones nuevas en la matriz de
  autorización, ninguna de las cuales concede nada a `tech-admin`.
- Las reglas de reforma dejan de estar en la cabeza de quien configura una decisión y pasan a estar en
  el ledger, con versión y diferencia publicable.
- **La cláusula de enmienda queda atrincherada estructuralmente**: una reforma ordinaria no puede
  tocar los requisitos de reforma ni la vigencia (`AMENDMENT_RULE_IS_ENTRENCHED`), la vía atrincherada
  no puede quedar más blanda que la ordinaria en ninguna dimensión
  (`ENTRENCHED_WEAKER_THAN_ORDINARY`), y ninguna vía puede bajar de la supermayoría
  (`THRESHOLD_BELOW_SUPERMAJORITY`).
- **Queda pendiente conectar el agregado**: no hay persistencia, ni rutas HTTP, ni pantalla, ni
  llamada a `assertConstitutionVigent` desde los demás agregados. Mientras eso no exista, la
  constitución es una garantía del dominio y no del producto.

## Erratas y contradicciones encontradas en `GOVERNANCE.md` (E63–E77)

Se numeran a continuación de las 62 anteriores del proyecto. Las tres primeras son **autodestructivas**:
aplicadas al pie de la letra, derogan la garantía que el propio documento quiere dar.

| # | Pasaje | Problema | Resolución aplicada |
|---|---|---|---|
| **E63** | §4 fila 14 vs §6.b y §10 | La fila 14 ofrece un procedimiento para «tocar el núcleo intangible» (3/4 en dos votaciones, 4 de 5 de Garantías); el §6.b dice que el núcleo «no es reformable por **ningún** procedimiento», y el §10 afirma **las dos cosas en el mismo párrafo**. **Autodestructiva:** con la lectura de la fila 14, la cláusula de atrincheramiento (b) no existe | Manda la irreformabilidad. La fila 14 gobierna la **sección 10** —la cláusula de enmienda— y no el contenido del núcleo, que no se toca por ninguna vía |
| **E64** | §4 fila 14 | No fija días de deliberación ni de espera; la fila 13 sí (21 y 14). Literalmente, reformar la cláusula de enmienda podría hacerse con **cero** días de deliberación: más barato que una reforma ordinaria | Piso estructural `entrenched ≥ ordinary` en **toda** dimensión, y 21/14 como valores de arranque |
| **E65** | §6, «cláusula de caducidad fundacional» | Da dos salidas incompatibles para la misma situación: «si no se **reratifica por el procedimiento ordinario**» (fila 13) y «el único camino honesto es la **refundación**… desde el problema del arranque» (§6.b). No dice cuál aplica **después** del vencimiento | Antes de vencer, reforma ordinaria —que renueva la vigencia—; después, sólo refundación, con la regla fundacional íntegra |
| **E66** | §6 vs núcleo (iv) y principio 5 | La caducidad está escrita **sólo para la versión 1**. Literalmente, la primera reforma ordinaria produce una constitución **perpetua**, derogando de hecho el punto (iv) del núcleo —«la caducidad de los acuerdos y de este núcleo»— por la vía barata y sin tocar su texto. **Autodestructiva** | `validityMonths` viaja en el texto, aplica a **toda** versión, se renueva al ratificar y sólo se cambia por la vía atrincherada |
| **E67** | §6 / §10 | Consecuencia de E66: nada acota la vigencia hacia arriba. Ponerla en 1 200 meses derogaría el punto (iv) sin alterar una coma | Techo de **24 meses**, que es el que el propio §10 se pone: «revisión ordinaria cada dos años» |
| **E68** | §4 fila 14 / §10 | Nada impide que una reforma atrincherada deje **todas** las futuras en mayoría simple sobre el censo. Es la misma puerta trasera que se rechaza para la caducidad, por otra puerta. **Autodestructiva** | Piso `> 1/2` para todo umbral de reforma. **No está en el documento**: es decisión de diseño, y se declara |
| **E69** | §6.c | «Los 30 días anteriores a una decisión ya convocada que se vería afectada por ella» exige saber qué decisiones están convocadas y **qué cláusulas afecta cada una**; el documento no define ninguna de las dos cosas. Con el calendario vivo, bastaría desconvocar una decisión para abrir la veda | El calendario se congela por valor al abrir, con la relación decisión→cláusulas declarada. Su veracidad no la puede comprobar el dominio: es lo que verifica Garantías (§6.6) |
| **E70** | §6.c | «Las dos últimas semanas del semestre» no tiene definición operable: no hay calendario académico en el documento ni se dice quién lo declara | `semesterEndsAt` entra como dato congelado en la apertura. El dominio no puede tener un calendario académico (ADR-0001) |
| **E71** | §6.6 y §7 | Pide «firma de 3 de los 5» y prohíbe que el administrador firme, pero **nada técnico se lo impide**: puede escribir el evento a nombre de un garante. ADR-0001 excluye la criptografía asimétrica del dominio | Se implementa como registro de aprobación con reautorización en el pliegue y **se declara en el código y aquí**: detección por anclaje y repudio público, no prevención |
| **E72** | §6, «el problema del arranque» | «2/3 de las papeletas con participación mínima de 100»: no dice si esa participación es **directa** o incluye delegación. La fila 13 sí lo aclara para la reforma | Lectura estricta: participación **directa**, por coherencia con la fila 13 y con el §5 («para lo constituyente la comunidad aparece con su propia mano») |
| **E73** | §6 | No dice qué pasa con **las reformas en curso** cuando la constitución caduca. Una reforma votada y firmada queda en el limbo | Se congela: con la constitución caducada no se ratifica nada. Tras la refundación su versión objetivo ya no es la vigente y se cierra por `version_desplazada` |
| **E74** | §6 y §10 | Dicen quién propone (30 firmas), quién vota (el censo) y quién firma (Garantías), pero **no quién abre** la reforma en el sistema, **quién transcribe** el resultado del escrutinio ni **quién declara** la ratificación. Sin eso, la matriz de autorización se inventa | Proponer = cualquier miembro (el freno son las firmas); transcribir y declarar = facilitación o Garantías (§7); firmar = **sólo** Garantías; `tech-admin` = nada |
| **E75** | §6 y §7 | «Koinonía queda sin reglas y **todo se suspende** salvo lectura y exportación» no puede vivir en este agregado: afecta a `engine.ts`, a las iniciativas y a la deliberación | El dominio ofrece `assertConstitutionVigent`; **nadie la llama todavía**. La suspensión efectiva es **deuda declarada**, no un hecho |
| **E76** | §5 vs §4 fila 13 | «Nunca se delega… la reforma de estas reglas **más allá del voto directo mínimo**» admite dos lecturas: que la delegación cuenta por encima del mínimo, o que queda prohibida del todo. La segunda haría que los 200 votos a favor tuvieran que ser todos directos, y entonces el quórum de «100 en voto directo» de la fila 13 no significaría nada | Se resuelve **por aritmética**: la delegación cuenta por encima del mínimo directo. `directParticipation` y `votesInFavor` son dos conteos distintos y ambos entran en el evento |
| **E77** | §6, composición de dos frases correctas | «Es más fácil aprobar la primera constitución que reformarla» + «la versión 1 vence a los doce meses» componen una **vía barata periódica**: cada doce meses, quien no consiga 200 de 300 para reformar puede dejar vencer y refundar con 2/3 de las papeletas —que con 150 papeletas son 100 personas—. El documento presenta la caducidad como *compensación* de la rebaja fundacional sin advertir que también la **habilita** | Mitigado en parte: el núcleo **sobrevive** a la refundación, así que la vía barata no lo alcanza. El resto del texto **sí queda expuesto**, y se declara. Cerrarlo del todo exigiría subir la regla fundacional, que es una decisión de la asamblea y no del dominio |

## Pruebas obligatorias

- **El pliegue**, y no la orden, rechaza un historial forjado que altere el núcleo: se fabrica el
  historial reencadenando con `appendChained`, se comprueba que `verifyChain` **pasa** y que
  `replayConstitution` **lanza**;
- el mismo forjado con cada uno de los seis puntos y en cualquiera de las reformas del historial
  (propiedad, semilla `30_000_821`);
- quitar del texto un punto del núcleo tampoco se pliega;
- el génesis reescrito entero **sí** se pliega —el límite— y el hash del núcleo anclado lo delata;
- el guardián corre en eventos que no tocan el texto;
- 200 de 300 pasa y 199 no; 225 pasa y 224 no;
- 21 días de deliberación son 21; 14 de espera son 14; 30 firmas son 30;
- 3 de 5 firmas: con dos, la regla queda aprobada pero no vigente; la misma persona no firma dos
  veces; no firma quien no estaba en el círculo congelado; Garantías no firma antes de la votación;
- la vía atrincherada exige dos votaciones separadas por un **semestre civil** y 4 de 5;
- una reforma ordinaria no toca la cláusula de enmienda ni la vigencia;
- una reforma que rebaja el umbral se mide con el umbral **viejo**, y la copia congelada que no
  coincide con lo vigente se rechaza;
- la veda del §6.c: fin de semestre y decisión convocada afectada vedan; una no afectada, no;
- caducada, sólo entra la refundación, y sigue exigiendo la regla fundacional completa; ni la
  refundación cambia el núcleo;
- dos reformas sobre la misma versión: ratifica una sola;
- tras N reformas, las N+1 versiones siguen recuperables y la versión 1 conserva su texto;
- producto cartesiano `Estado × Evento` de la máquina de reformas: lo que no está en la tabla lanza;
- **`tech-admin` no tiene ninguna capacidad**: ni fundar, ni proponer, ni transcribir la votación, ni
  aprobar, ni ratificar —ni votar—, comprobado en la matriz y lanzando desde las órdenes;
- el agregado es alcanzable importando desde `@koinonia/domain`.
