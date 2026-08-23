/**
 * Persistencia de la **constitución digital** (`GOVERNANCE.md` §6, ADR-0051).
 *
 *  - `codec.ts`      — el codificador explícito, campo a campo. Los `bigint` de las fracciones
 *                      viajan como cadena decimal y el decodificador **valida** en vez de acomodar.
 *  - `text-store.ts` — el texto normativo, direccionado por su propia huella y comprobado al leer.
 *  - `repository.ts` — escribir el tramo pendiente y rehidratar plegando, que es donde se revalida
 *                      la autorización de cada firma de Garantías.
 *
 * ═══ Las dos decisiones que había que tomar, y por qué éstas ═══
 *
 * **(1) Dónde vive el texto de las reglas.** En `governance.clause_text`, **aparte del ledger y
 * dentro de la base**, con la huella como clave primaria.
 *
 * No en el ledger porque el agregado está cerrado: `Clause` es `(clauseId, textHash)` y ADR-0051
 * rechazó guardar prosa y huella juntas —«añade una forma de mentir, declarar una huella que no
 * corresponde al texto, sin añadir ninguna garantía»—. Meter el texto en el payload exigiría
 * cambiar `packages/domain`, que en esta entrega no se toca.
 *
 * No fuera de la base porque el §6.5 obliga a publicar «versión, fecha y diferencia respecto de la
 * anterior», y una diferencia contra un texto que hay que ir a buscar a otro sitio no se puede
 * comprobar desde la pantalla que la muestra. Lo que depende de que alguien mantenga otra cosa
 * sincronizada no es una garantía.
 *
 * Direccionado por contenido porque cierra la única discrepancia posible: la correspondencia
 * cláusula → huella vive **sólo** en el ledger, aquí sólo vive huella → texto, y al leer se
 * recomputa SHA-256 y se compara con la clave. Un texto alterado no gana: deja de resolver, y la
 * pantalla lo dice. De regalo, una cláusula que no cambia entre dos versiones se archiva una vez y
 * las dos la resuelven, que es lo que hace barato «se conservan todas las versiones».
 *
 * **(2) El arranque.** Nadie funda por vos: el sistema **funciona sin constitución** hasta que una
 * persona registra el acto fundacional por `POST /normas/fundacion`. El argumento largo está en
 * `http/service.ts`, sobre `fundarNormas`; el corto es que `applyConstitution` rechaza
 * `actor: 'system'` —ningún acto de gobierno es un automatismo—, así que una migración tendría que
 * mentir sobre el actor, inventarse el censo y los votos de una asamblea que no se celebró, y
 * arrancar el reloj de doce meses del §6 el día que alguien instala el servidor.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ERRATAS Y CONTRADICCIONES (E88–E94)
 *
 * Continúa el registro del proyecto, que iba por E87 (ADR-0052). Todas salieron de **intentar
 * escribir** el agregado: son las que no se ven leyendo el documento ni leyendo el dominio, sino
 * al preguntarse qué se puede guardar y qué se puede volver a leer.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **E88 · El texto de las normas no cabía en ninguna parte, y el producto lo promete.**
 * §6.5 exige publicar la «diferencia respecto de la anterior» y la pantalla `/normas` promete el
 * texto de cada regla; el agregado, por decisión consciente de ADR-0051, sólo guarda huellas. Con
 * huellas, la diferencia publicable es una lista de etiquetas: se puede decir **que** cambió
 * `horario_de_la_sala`, no **qué** cambió. Las dos decisiones son correctas por separado y juntas
 * no cierran. Resuelto con el almacén direccionado por contenido de `text-store.ts`. Queda un
 * borde declarado: un historial traído de fuera puede nombrar huellas que aquí no están
 * archivadas, y entonces la lectura falla en vez de enseñar una regla en blanco.
 *
 * **E89 · La votación fundacional no cabe en la plataforma, y el `foundingDecisionId` finge que
 * sí.** El evento guarda «la decisión que la ratificó en asamblea abierta» como un `DecisionId`.
 * Pero abrir una decisión exige una `DecisionConfig` con umbrales, quórum y método, y el §6 dice
 * que esos umbrales **son** la constitución: la votación que aprueba la versión 1 no puede
 * celebrarse dentro de un sistema cuyas reglas todavía no existen. El `foundingDecisionId` es, en
 * el arranque, un identificador opaco que no está obligado a corresponder a nada. Propuesta para
 * el documento: que el §6 exija publicar y **anclar** el acta y el escrutinio antes de registrar
 * la fundación, y que ese campo sea la huella del acta anclada y no un identificador interno.
 *
 * **E90 · El freno del §6 —las 30 firmas— es hoy un número que teclea quien propone.**
 * La fila 13 y el §6 hacen de las «30 firmas (10 % del censo)» la primera de las seis garantías
 * acumuladas, y la matriz de autorización lo da por bueno a propósito: proponer es un derecho de
 * miembro «porque lo que la frena son las firmas». Pero **no existe** el respaldo como hecho: no
 * hay agregado, ni evento, ni pantalla para firmar una propuesta de reforma. `sponsorCount` entra
 * como entero en el evento y el pliegue lo compara contra el censo congelado, es decir, compara
 * una afirmación de quien abre consigo misma. Cualquier miembro puede abrir reformas sin más
 * freno que el cupo de escritura. Propuesta concreta: modelar el respaldo como eventos
 * `ReformSponsored` —una firma, un hecho, con su actor— y **derivar** `sponsorCount` del pliegue
 * en vez de aceptarlo. Mientras tanto, el número está publicado con autor y fecha, que es lo
 * único que hoy lo hace contradecible.
 *
 * **E91 · El §6.6 le encarga a Garantías verificar un procedimiento que el sistema no puede
 * enseñarles.** La veda del §6.c se decide con dos datos que sólo existen como declaración de
 * quien abre la reforma: el fin del semestre y, por cada votación ya convocada, de qué cláusulas
 * depende. Lo primero no está en ninguna parte (no hay calendario académico); lo segundo tampoco:
 * `DecisionConfig` no tiene un campo que diga de qué reglas depende una votación. Así que el §6.6
 * manda comprobar algo **sin fuente contra la que comprobarlo**. Propuesta: que una decisión
 * declare las cláusulas de las que depende —cabe al lado de `constituentAct`— y que el calendario
 * académico se publique como acuerdo de Coordinación por la vía «hacia abajo» del §10.
 *
 * **E92 · Hay dos padrones congelados en una misma reforma y el documento no dice cuál manda.**
 * §2(a) congela el padrón **al abrir cada decisión**; el §6 mide los umbrales de la reforma sobre
 * «el censo». La reforma congela su censo el día que se abre y su votación congela el suyo
 * veintiún días después —o un semestre, en la vía atrincherada—, y los dos números pueden diferir:
 * gente que se gradúa, gente que se matricula. Los votos se cuentan sobre un padrón y el umbral
 * se mide sobre otro. El agregado resuelve midiendo contra el censo congelado **al abrir la
 * reforma**, que es lo coherente con «no se cambian las reglas viendo el marcador», y aquí queda
 * declarado porque el documento no elige. Propuesta: decirlo en el §6, o congelar el censo de la
 * reforma al abrir **la votación** y no antes.
 *
 * **E93 · El padrón es el denominador de toda la sección 4 y es el único estado de gobierno que
 * no deja rastro en el historial.** La fila 19 dice que el alta y la baja «no se votan: son un
 * hecho verificable», y el §7 le prohíbe al administrador «crear, eliminar o modificar miembros
 * del padrón» prometiendo que «todo acto administrativo es un evento público en el mismo
 * historial». No lo es: la pertenencia vive en `identity.member`, una tabla mutable sin cadena de
 * huellas ni anclaje. Nadie puede demostrar después cuál era el censo el día que se abrió una
 * reforma —salvo, y sólo porque este agregado lo copia por valor, el número que quedó congelado en
 * el evento—. Esta entrega **agrava** la exposición al derivar de esa tabla el censo y la
 * identidad de las cinco personas de Garantías. Propuesta: un agregado de padrón event-sourced,
 * que es además lo que el §7 promete que ya existe.
 *
 * **E94 · Detectar una firma fabricada deja la pantalla de normas sin poder enseñar nada.**
 * Medido en `tests/integration/constitucion.test.ts`: si quien administra escribe en la base una
 * aprobación de Garantías atribuida a otra persona, el pliegue la rechaza al **releer** y
 * `GET /normas` deja de responder las reglas y responde el motivo. Es la detección funcionando, y
 * a la vez un modo de fallo que el §7 no anticipa: quien puede escribir en la base puede dejar en
 * blanco la pantalla que publica las normas. La alternativa —enseñar las reglas ignorando el hecho
 * que no pliega— sería peor: sería enseñar una constitución que el sistema mismo no puede
 * sostener. Se elige fallar ruidosamente y se declara. Mitigación pendiente: que la pantalla
 * distinga «no hay reglas» de «las reglas no se pueden verificar» con un aviso propio, en vez de
 * un error genérico.
 */

export {
  CONSTITUTION_AGGREGATE_TYPE,
  CONSTITUTION_EVENT_VERSION,
  ConstitutionCodecError,
  decodeConstitutionEvent,
  encodeConstitutionEvent,
} from './codec.js';

export {
  CONSTITUTION_AGGREGATE_ID,
  ConstitutionPersistenceError,
  loadConstitutionLog,
  loadConstitutionState,
  persistConstitutionLogWithin,
  type ConstitutionPersistResult,
} from './repository.js';

export {
  assertWellFormedClauseText,
  CLAUSE_TEXT_SEPARATOR,
  type ClauseText,
  ClauseTextError,
  clauseTextHash,
  clauseTextPreimage,
  normalizeClauseText,
  readClauseTexts,
  saveClauseTextsWithin,
} from './text-store.js';
