/**
 * Forma de los errores de la API y su traducción a palabras.
 *
 * WCAG 2.2 AA exige «errores en palabras, no en códigos» y PRODUCT lo repite en la tabla de
 * pantallas: «se bloquea con explicación, no con un código». Las dos cosas conviven: el `codigo` es
 * para el registro y para la lógica del cliente; `mensaje` es lo que lee una persona, y sale de
 * aquí para que no haya dos redacciones del mismo rechazo.
 *
 * ═══ La regla que gobierna cada frase de este fichero ═══
 *
 * **Un mensaje dice qué pasó y qué hacer ahora.** Sólo lo primero es un callejón: «No encontramos
 * ese problema» deja a la persona mirando una pantalla sin salida, y peor todavía cuando el motivo
 * real era otro —que el problema existe pero ya no admite aportes—. WCAG 2.2 lo pide como criterio
 * (3.3.3, sugerencias ante error), pero acá hay además una razón política: quien se topa con un
 * rechazo mudo concluye que el sistema no es suyo, y deja de volver.
 *
 * Y se aplica también la regla de oro de la interfaz (ADR-0041): estas frases se leen en pantalla,
 * así que ninguna puede llevar el vocabulario del motor. `packages/contracts/test/errores.test.ts`
 * lo comprueba palabra por palabra contra `FORBIDDEN_UI_TERMS`, para que no vuelva a colarse un
 * «fuera de orden» explicado con el nombre interno de lo que se escribe en el historial.
 */

import { z } from 'zod';

export const apiError = z.object({
  /** Código estable. Nunca se muestra solo. */
  codigo: z.string(),
  /** Frase en español, dirigida a quien la lee, sin jerga. */
  mensaje: z.string(),
  /** Qué campo del formulario está mal, si aplica. */
  campo: z.string().optional(),
  /** Qué se puede hacer al respecto. Un error sin salida es un callejón. */
  queHacer: z.string().optional(),
});

export type ApiError = z.infer<typeof apiError>;

/**
 * Traducción de los códigos del dominio a frases.
 *
 * Está aquí, en `contracts`, y no en la web: si viviera en la web, un cliente distinto —el
 * verificador independiente, un guion de alguien— mostraría el código crudo, y el mismo rechazo
 * tendría dos caras.
 */
export const MENSAJES: Readonly<Record<string, string>> = {
  // ── Autorización ────────────────────────────────────────────────────────────────────────────
  UNAUTHORIZED_NOT_AUTHENTICATED:
    'Para hacer esto hay que entrar con el correo institucional. Tu borrador se conserva.',
  UNAUTHORIZED_ROLE_NOT_GRANTED:
    'Tu papel en el Instituto no incluye esta acción. Si hace falta que se haga, pedíselo a quien ' +
    'cuida el procedimiento en tu grupo: puede hacerlo y queda a su nombre.',
  UNAUTHORIZED_NOT_THE_OWNER:
    'Esto lo escribió otra persona y sólo ella puede cambiarlo. Podés responderle o proponer una ' +
    'enmienda, que queda como texto tuyo.',
  UNAUTHORIZED_NOT_THE_SUBJECT:
    'Nadie puede actuar en nombre de otra persona. Este acto quedaría a nombre de alguien que no ' +
    'sos vos. Si la cuenta que abriste no es la tuya, salí y volvé a entrar con tu correo.',
  UNAUTHORIZED_NOT_A_READER:
    'Ese material restringido sólo puede abrirlo quien lo aportó o quien debe revisar la entrega. ' +
    'Si necesitás verlo, pedíselo a quien lo subió: puede contarlo o volver a aportarlo.',
  UNAUTHORIZED_NOT_IN_CIRCLE:
    'Este asunto lo lleva otro grupo, y hay que ser parte de él. Podés leerlo igual, y si te ' +
    'afecta, escribí el problema en tu propio grupo: desde ahí se reenvía a quien decide.',
  UNAUTHORIZED_OWNER_UNKNOWN:
    'No encontramos eso que querés cambiar; puede que se haya movido o que el enlace esté viejo. ' +
    'Volvé a la lista y abrilo desde ahí.',

  // ── Sesión y correo ─────────────────────────────────────────────────────────────────────────
  ENLACE_INVALIDO: 'Ese enlace no sirve. Pedí uno nuevo desde la pantalla de entrar.',
  ENLACE_VENCIDO: 'Ese enlace ya venció. Los enlaces duran 15 minutos; pedí uno nuevo.',
  ENLACE_YA_USADO:
    'Ese enlace ya se usó una vez y no se puede volver a usar. Pedí uno nuevo si necesitás entrar otra vez.',
  CORREO_NO_INSTITUCIONAL:
    'Sólo entran los correos que terminan en @udea.edu.co. Es lo único que verificamos: matrícula ' +
    'activa. Probá con tu dirección institucional; si no la tenés a mano, lo público se lee sin cuenta.',
  DEMASIADOS_INTENTOS: 'Pediste muchos enlaces seguidos. Esperá un momento y volvé a intentar.',
  ERASURE_REAUTHENTICATION_REQUIRED:
    'Para pedir una supresión irreversible tenés que volver a entrar. La sesión reciente confirma que sos vos.',
  ERASURE_ALREADY_REQUESTED:
    'Ya existe una solicitud de supresión a tu nombre. Conservá el radicado; no hace falta crear otra.',
  ERASURE_AUTHORIZATION_UNAVAILABLE:
    'No existe una solicitud propia válida que autorice esa supresión, y no se borró ningún dato. ' +
    'Pedí la supresión desde tu propia cuenta y conservá el radicado que te damos.',

  // ── Textos ──────────────────────────────────────────────────────────────────────────────────
  INVALID_TEXT:
    'Falta texto o hay demasiado. Fijate en la ayuda que está debajo del campo: dice el mínimo y el ' +
    'máximo que se admiten.',

  // ── Reuniones ───────────────────────────────────────────────────────────────────────────────
  NEEDS_PLACE_OR_LINK:
    'Hace falta decir dónde es: un lugar físico, un enlace remoto, o los dos. Sin eso nadie sabe ' +
    'cómo llegar.',
  AGENDA_REQUIRED:
    'Una reunión se convoca con orden del día: hay que agregar al menos un punto antes de ' +
    'convocarla.',
  TOO_MANY_AGENDA_ITEMS:
    'El orden del día admite pocos puntos: hay que agrupar algunos o dividir la reunión en dos.',
  DUPLICATE_ID: 'Hay dos puntos o dos acuerdos con el mismo identificador. Volvé a intentarlo.',
  MEETING_NOT_CONVENED:
    'Esa reunión ya no existe o el enlace está mal escrito: volvé a la lista e intentá desde ahí.',
  MEETING_ALREADY_CONVENED: 'Esa reunión ya estaba convocada: no hace falta convocarla de nuevo.',
  MINUTES_ALREADY_PUBLISHED:
    'Esta reunión ya tiene acta publicada: no se publica una segunda vez, mirá la que ya está.',
  MINUTES_NOT_PUBLISHED:
    'Todavía no hay acta publicada para esta reunión: esperá a que quien la convocó la publique.',
  TOO_MANY_AGREEMENTS:
    'El acta admite pocos acuerdos: hay que publicar los principales y agregar el resto después.',
  UNKNOWN_AGREEMENT:
    'Ese acuerdo no existe en el acta de esta reunión: volvé a cargar la pantalla y probá otra vez.',
  AGREEMENT_WITHOUT_PROBLEM:
    'Este acuerdo no dice a qué problema responde, y sin eso no se puede convertir en propuesta. ' +
    'Volvé a publicar el acta indicando el problema, o escribí la propuesta desde cero.',
  AGREEMENT_ALREADY_LINKED:
    'Ese acuerdo ya se había convertido en propuesta: mirá cuál es en el acta de la reunión.',
  // Faltaba, y sin entrada acá quien se topaba con este rechazo veía el código en crudo en vez de
  // una frase. La revisión independiente lo encontró: la ruta lo lanzaba y la tabla no lo conocía.
  PROPOSAL_PROBLEM_MISMATCH:
    'Esa propuesta responde a otro problema, así que no es la que salió de este acuerdo. ' +
    'Elegí la propuesta que trata el mismo problema, o escribí una nueva desde el acuerdo.',
  EMPTY_PROPOSAL_ID:
    'Falta indicar qué propuesta salió de este acuerdo: elegí una de la lista antes de guardar.',

  // ── Papeletas ───────────────────────────────────────────────────────────────────────────────
  BALLOT_INELIGIBLE_VOTER:
    'No estabas en la lista de quienes podían decidir aquí, que se cerró al abrir la votación. ' +
    'Podés leer el texto y el resultado, y escribir tu postura en la conversación del problema.',
  BALLOT_OUT_OF_WINDOW:
    'La votación ya cerró. No hay período de gracia: cierra cuando dice. Mirá el resultado y por ' +
    'qué salió eso; si hay algo que objetar, ahí está el plazo para impugnarlo.',
  BALLOT_STALE_PROPOSAL_VERSION:
    'El texto cambió después de que emitiste tu respuesta. Hay que volver a responder sobre el texto nuevo: ' +
    'estar de acuerdo con un texto es estar de acuerdo con ese texto.',
  BALLOT_OBJECTION_REQUIRED:
    'Para objetar hay que decir qué se daña y por qué. Completá los dos campos de la objeción, o ' +
    'elegí «tengo una reserva», que queda escrita y no bloquea.',
  BALLOT_OBJECTION_ARGUMENT_TOO_SHORT:
    'La objeción necesita más argumento: bloquear a la comunidad tiene que costar, como mínimo, ' +
    'explicarse. Contá el daño concreto con algo más de detalle, o dejalo como reserva.',
  BALLOT_OBJECTION_AIM_MISSING:
    'Una objeción señala un daño a lo que el grupo se propuso. Sin eso es una preferencia, que se ' +
    'registra como reserva. Escribí qué objetivo del grupo se daña, o elegí «tengo una reserva».',
  BALLOT_PAYLOAD_KIND_NOT_ACCEPTED:
    'Esa forma de responder no es la que corresponde a esta decisión. Volvé a abrirla y respondé ' +
    'con las opciones que muestra la pantalla.',

  // ── Estado ──────────────────────────────────────────────────────────────────────────────────
  ILLEGAL_TRANSITION:
    'Esto no se puede hacer en el momento en el que está el asunto. Volvé a cargar la pantalla ' +
    'para ver en qué va y qué acciones quedan disponibles ahora.',
  NOT_CLOSED:
    'Todavía no hay resultado: la votación sigue abierta. Volvé cuando venza el plazo, que está ' +
    'escrito en la propia votación.',
  // Decía «No encontramos ese problema», que además de no dar salida era falso: el problema
  // existe y se puede leer; lo que ya no admite es que se le agregue nada.
  PROBLEM_NOT_OPEN:
    'Este problema ya no está recogiendo aportes, así que no se le puede agregar nada más. ' +
    'Podés leer lo que tiene y seguir por las propuestas que salieron de él; si lo que te pasa es ' +
    'otra cosa, escribilo como un problema nuevo.',
  ALREADY_ME_TOO:
    'Ya habías dicho que te pasa lo mismo, y no se cuenta dos veces. No hace falta que hagas nada ' +
    'más: si querés sumar algo, aportá lo que sepas del problema.',
  NOT_THE_OWNER:
    'Esto lo escribió otra persona y sólo ella puede cambiarlo. Podés responderle o proponer una ' +
    'enmienda, que queda como texto tuyo y con tu nombre.',
  NON_CONSECUTIVE_VERSION: 'Alguien enmendó el texto mientras escribías. Mirá la versión nueva.',
  VERSION_UNCHANGED:
    'El texto quedó igual que antes, así que no hay nada nuevo que guardar. Cambiá algo del texto ' +
    'o del plan antes de guardar, o dejalo como está.',
  NO_RATIONALE:
    'Hay que decir qué cambia y por qué. Sin eso, «versión 2» es un número sin información.',
  IDEMPOTENCY_KEY_REUSED:
    'Esa clave ya quedó ligada a otra acción. No se escribió nada nuevo ni se cambió el historial. ' +
    'Volvé a cargar la pantalla y, si lo que querías hacer sigue sin aparecer, hacelo otra vez.',

  // ── Ratificación y ejecución ────────────────────────────────────────────────────────────────
  CHALLENGE_WINDOW_OPEN:
    'Todavía está abierto el tiempo para impugnar esta decisión, y la iniciativa no puede empezar ' +
    'hasta que venza. Esperá a que se cumpla el plazo que figura en la decisión y volvé a intentarlo.',
  OUTCOME_NOT_RATIFIABLE:
    'Esta decisión no tiene un resultado que pueda ratificarse para empezar la iniciativa. Abrí el ' +
    'resultado para ver qué salió y qué sigue.',
  OUTCOME_NOT_REJECTABLE:
    'Esta decisión no está en un estado que permita registrar ese rechazo. Volvé a cargar la ' +
    'pantalla para ver en qué va.',
  RESULT_ALREADY_COMPUTED:
    'El resultado ya fue publicado y no puede calcularse ni publicarse una segunda vez. Abrilo: ' +
    'está entero, con el detalle de por qué salió eso.',
  RATIFICATION_REQUIRES_MEMBER:
    'La ratificación debe hacerla una persona integrante vigente del grupo que tomó la decisión. ' +
    'Pedísela a alguien del grupo; no hace falta reunión.',
  INITIATIVE_ALREADY_ACTIVATED:
    'Esta iniciativa ya está activa. Volvé a cargar la pantalla: vas a ver sus hitos y sus tareas.',
  INITIATIVE_ALREADY_CREATED:
    'Esta iniciativa ya fue creada y no puede crearse de nuevo. Abrila desde la decisión que le dio ' +
    'origen.',
  INITIATIVE_GENESIS_REQUIRED:
    'Falta el origen comprobable de esta iniciativa, y no se sigue adelante con un historial ' +
    'incompleto. No se escribió nada. Contalo en el grupo: esto hay que mirarlo, no reintentarlo.',
  INITIATIVE_NOT_ACTIVE:
    'Esta iniciativa todavía no está activa: primero tiene que vencer el plazo de impugnación y hay ' +
    'que ratificar la decisión. Mirá la decisión para ver cuándo vence.',
  INITIATIVE_REQUIRES_APPROVED:
    'Sólo una decisión aprobada puede convertirse en una iniciativa activa. Mirá el resultado de la ' +
    'decisión para ver qué salió.',
  INITIATIVE_RESPONSIBLE_ONLY:
    'Sólo la persona responsable inicial puede organizar los primeros hitos y ofrecer tareas. ' +
    'Pedíselo a quien figura como responsable en la iniciativa.',
  INITIATIVE_SYSTEM_ONLY:
    'Crear y activar una iniciativa son actos automáticos ligados a la decisión, y una persona no ' +
    'puede forzarlos. Ratificá la decisión cuando venza el plazo de impugnación: eso los dispara.',
  // «evento» está prohibido en pantalla (ADR-0041): nombra la fontanería del historial y no le
  // importa a nadie que quiera trabajar. Lo que la persona necesita saber es que no se escribió
  // nada y qué hacer ahora.
  NON_CONSECUTIVE_INITIATIVE_EVENT:
    'El historial de esta iniciativa no cuadra: falta algo o quedó anotado fuera de su sitio. No se ' +
    'escribió nada nuevo. Volvé a cargar la pantalla; si sigue igual, contalo en el grupo sin ' +
    'volver a intentarlo.',
  INITIATIVE_MILESTONE_NOT_FOUND:
    'No encontramos ese hito dentro de esta iniciativa. Volvé a cargar la pantalla y elegilo de la ' +
    'lista de hitos.',
  INITIATIVE_RESPONSIBLE_REQUIRED:
    'Sólo la persona responsable inicial puede organizar los primeros hitos y ofrecer tareas. ' +
    'Pedíselo a quien figura como responsable en la iniciativa.',
  UNKNOWN_MILESTONE:
    'No encontramos ese hito dentro de esta iniciativa. Volvé a cargar la pantalla y elegilo de la ' +
    'lista de hitos.',
  DUPLICATE_MILESTONE:
    'Ese hito ya existe en esta iniciativa. Si querés otro, dale un título distinto; si querés ' +
    'cambiar el que hay, trabajá sobre él.',
  MILESTONE_DUE_AFTER_REVIEW:
    'La fecha del hito no puede pasar la revisión que la comunidad aprobó para esta iniciativa. ' +
    'Elegí una fecha anterior a esa revisión.',
  MILESTONE_AFTER_REVIEW:
    'La fecha del hito no puede pasar la revisión que la comunidad aprobó para esta iniciativa. ' +
    'Elegí una fecha anterior a esa revisión.',
  DUPLICATE_TASK:
    'Esa tarea ya existe en esta iniciativa. Buscala en su hito: desde ahí se ofrece y se sigue.',
  UNKNOWN_TASK:
    'No encontramos esa tarea dentro de esta iniciativa. Volvé a cargar la pantalla: puede que se ' +
    'haya reasignado mientras tanto.',
  TASK_EFFORT_INVALID:
    'El esfuerzo estimado tiene que ser un número entero de minutos, entre uno y siete días. ' +
    'Escribí una estimación dentro de ese rango; si no cabe, partí la tarea en dos.',
  TASK_DUE_AFTER_MILESTONE:
    'La fecha de la tarea no puede pasar la fecha límite de su hito. Elegí una fecha anterior, o ' +
    'movés antes la del hito.',
  TASK_DEPENDENCY_NOT_FOUND:
    'Una de las tareas de las que depende esta no existe en esta iniciativa. Quitala de la lista de ' +
    'dependencias o creala antes.',
  UNKNOWN_TASK_DEPENDENCY:
    'Una de las tareas de las que depende esta no existe en esta iniciativa. Quitala de la lista de ' +
    'dependencias o creala antes.',
  TASK_DEPENDENCY_DUPLICATE:
    'Una misma tarea no puede aparecer dos veces como dependencia. Desmarcá la repetida.',
  TASK_DEPENDENCY_SELF: 'Una tarea no puede depender de sí misma. Desmarcala de sus dependencias.',
  TASK_SELF_DEPENDENCY: 'Una tarea no puede depender de sí misma. Desmarcala de sus dependencias.',
  TASK_DEPENDENCY_CYCLE:
    'Estas dependencias se muerden la cola y así nadie podría empezar. Quitá una de las que cierran ' +
    'el círculo.',
  TOO_MANY_TASK_DEPENDENCIES:
    'La tarea tiene demasiadas dependencias. Dividila en una parte más pequeña y verificable.',
  STALE_TASK_OFFER: 'Esa oferta ya fue reemplazada. Revisá la oferta vigente antes de responder.',
  STALE_TASK_REVISION:
    'La tarea cambió mientras respondías. Revisá su estado vigente antes de volver a intentarlo.',
  TASK_OFFER_NOT_PENDING:
    'Esa oferta ya recibió una respuesta y no puede volver a responderse. Volvé a cargar «Mis ' +
    'tareas» para ver cómo quedó.',
  TASK_OFFER_ALREADY_ANSWERED:
    'Esa oferta ya recibió una respuesta y no puede volver a responderse. Volvé a cargar «Mis ' +
    'tareas» para ver cómo quedó.',
  TASK_ACTOR_MISMATCH:
    'Esta oferta está dirigida a otra persona y sólo ella puede responderla. Mirá «Mis tareas»: ahí ' +
    'están las que te ofrecieron a vos.',
  INVALID_TASK_RESPONSE_REASON:
    'Elegí uno de los motivos generales. Si no querés contarlo, podés elegir “Prefiero no publicar el motivo”.',
  TASK_REASSIGNMENT_NOT_ALLOWED:
    'Esta tarea no está asignada de una forma que permita pedir reasignación. Volvé a cargar «Mis ' +
    'tareas» para ver en qué estado está y qué se puede hacer.',
  TASK_REOFFER_NOT_ALLOWED:
    'Sólo una tarea rechazada o con reasignación solicitada puede ofrecerse de nuevo. Volvé a cargar ' +
    'la iniciativa para ver en qué estado está.',
  TASK_REOFFER_SAME_RECIPIENT:
    'Ofrecerla otra vez a quien la rechazó no resuelve el bloqueo. Elegí a otra persona del grupo ' +
    'para esta oferta.',
  TASK_OFFER_ID_REUSED:
    'Esa oferta ya estaba registrada. No se escribió una segunda ni se reemplazó la anterior. Volvé ' +
    'a cargar la iniciativa: la que vale ya está ahí.',
  TASK_START_NOT_ALLOWED:
    'Esta tarea no está lista para empezar. Revisá si sigue aceptada y si sus dependencias ya terminaron.',
  TASK_DEPENDENCY_NOT_COMPLETED:
    'Todavía falta terminar una tarea de la que depende este trabajo. En la iniciativa se ve cuál y ' +
    'cómo va; podés empezar en cuanto se complete.',
  TASK_BLOCK_NOT_ALLOWED:
    'Esta tarea no está en un estado que permita declarar un bloqueo: hay que haberla comenzado. ' +
    'Volvé a cargar «Mis tareas» para ver en qué va.',
  TASK_HELP_NOT_ALLOWED:
    'Esta tarea no está en un estado que permita pedir ayuda: hay que haberla comenzado. Volvé a ' +
    'cargar «Mis tareas» para ver en qué va.',
  TASK_RESUME_NOT_ALLOWED:
    'Esta tarea no tiene una pausa vigente que se pueda reanudar. Volvé a cargar «Mis tareas»: puede ' +
    'que ya esté otra vez en curso.',
  STALE_TASK_PAUSE:
    'La pausa cambió mientras actuabas. Revisá el estado vigente antes de volver a intentarlo.',
  TASK_EVIDENCE_NOT_ALLOWED:
    'Esta tarea no está recibiendo evidencia en este momento. Volvé a cargarla: si está en pausa, ' +
    'primero hay que reanudarla.',
  INVALID_TASK_EVIDENCE_KIND_CODE:
    'El tipo general de evidencia no es uno de los admitidos. Elegí uno de la lista.',
  INVALID_TASK_EVIDENCE_SIZE_CLASS:
    'La clase general de tamaño no es una de las admitidas. Elegí una de la lista.',
  INVALID_TASK_EVIDENCE_VISIBILITY:
    'La visibilidad de la evidencia no es una de las admitidas. Elegí una de la lista.',
  TASK_DELIVERY_NOT_ALLOWED:
    'Para entregar, la tarea tiene que estar en curso, sin pausa vigente y con alguna evidencia. ' +
    'Reanudala si está en pausa y aportá al menos una evidencia antes de entregar.',
  TASK_DELIVERY_EVIDENCE_COUNT_INVALID:
    'La entrega tiene que apoyarse en al menos una evidencia. Marcá una de las que aportaste antes ' +
    'de entregar.',
  TASK_DELIVERY_EVIDENCE_DUPLICATE:
    'Una evidencia sólo puede aparecer una vez en la entrega. Desmarcá la repetida.',
  UNKNOWN_TASK_EVIDENCE:
    'Esa evidencia no pertenece a esta tarea. Elegí una de las que aparecen en la lista de la tarea.',
  STALE_TASK_DELIVERY:
    'La entrega cambió mientras actuabas. Revisá la entrega vigente antes de volver a intentarlo.',
  TASK_REVIEW_NOT_ALLOWED:
    'Esta entrega ya fue revisada o todavía no está lista para revisión. Volvé a cargar la ' +
    'iniciativa para ver en qué va.',
  INVALID_TASK_BLOCK_CATEGORY:
    'Esa no es una de las causas generales de bloqueo. Elegí una de la lista antes de continuar.',
  INVALID_TASK_HELP_CATEGORY:
    'Ese no es uno de los tipos generales de ayuda. Elegí uno de la lista antes de continuar.',
  INVALID_TASK_CHANGE_REASON:
    'Ese no es uno de los motivos generales para pedir cambios. Elegí uno de la lista antes de ' +
    'continuar.',
  TASK_EVIDENCE_ID_REUSED:
    'Esa evidencia ya estaba registrada y no se escribió una segunda. Volvé a cargar la tarea: la ' +
    'que vale ya está en su lista.',
  TASK_DELIVERY_ID_REUSED:
    'Esa entrega ya estaba registrada y no se escribió una segunda. Volvé a cargar la tarea: la que ' +
    'vale ya está ahí.',
  TASK_PAUSE_TIME_REVERSED:
    'Las fechas de la pausa no cuadran entre sí y no se escribió ningún cambio. Volvé a cargar la ' +
    'tarea; si sigue igual, contalo en el grupo sin volver a intentarlo.',

  // ── Capacidad privada ──────────────────────────────────────────────────────────────────────
  STALE_CAPACITY_REVISION:
    'Tu capacidad cambió mientras la estabas editando. Revisá el valor vigente antes de volver a guardar.',
  CAPACITY_SERVICE_UNAVAILABLE:
    'Tu capacidad privada no está disponible en este momento, y no se muestra ni se guarda un valor ' +
    'sin protección. Volvé a intentarlo en un rato; mientras tanto no aceptes tareas a ciegas.',
  PRIVATE_MATERIAL_UNAVAILABLE:
    'Ese material restringido no está disponible o no pudo comprobarse de forma segura, así que no ' +
    'se muestra nada a medias. Volvé a intentarlo en un rato; si sigue igual, contalo en el grupo.',
  TASK_CAPACITY_NOT_DECLARED:
    'No pudimos confirmar esta aceptación. Revisá tu capacidad propia antes de volver a intentarlo.',
  TASK_CAPACITY_CONFIRMATION_BLOCKED:
    'No pudimos confirmar esta aceptación. Revisá tu capacidad propia antes de volver a intentarlo.',
  TASK_CAPACITY_EXCEEDED:
    'No se pudo confirmar esta tarea con tu capacidad vigente. Revisá tu capacidad privada en Mis tareas.',
  TASK_CAPACITY_ADMISSION_REQUIRED:
    'No se pudo comprobar tu capacidad de forma segura, así que no se aceptó la tarea. Volvé a ' +
    'cargar «Mis tareas», revisá que tu capacidad esté declarada y probá otra vez.',
  TASK_CAPACITY_ADMISSION_MISMATCH:
    'La comprobación de capacidad ya no corresponde a esta oferta. Revisá la tarea vigente.',
  TASK_ACCEPTANCE_CANDIDATE_REQUIRED:
    'No se pudo comprobar la oferta antes de mirar tu capacidad, así que no se aceptó la tarea. ' +
    'Volvé a cargar «Mis tareas» y respondé sobre la oferta vigente.',

  // ── Genéricos ───────────────────────────────────────────────────────────────────────────────
  //
  // Son los que más se leen, porque cubren todo lo que no tiene un código propio, y eran los tres
  // más mudos del fichero: «No encontramos eso» no dice ni qué era «eso» ni adónde ir.
  NO_ENCONTRADO:
    'No encontramos eso. Puede que el enlace esté viejo o que se haya movido: volvé a la lista y ' +
    'abrilo desde ahí.',
  DATOS_INVALIDOS:
    'Faltan datos o alguno no tiene la forma esperada. Repasá los campos marcados en rojo: cada uno ' +
    'dice debajo qué se espera. Lo que escribiste no se perdió.',
  CONFLICTO:
    'Alguien más escribió al mismo tiempo. Volvé a cargar la pantalla para ver lo último y mandá otra ' +
    'vez lo tuyo: no se pisó nada.',
  ERROR_INTERNO:
    'Algo se rompió de nuestro lado. No se perdió nada de lo que ya estaba guardado: el historial no ' +
    'se toca. Volvé a intentarlo en un momento, y si sigue igual, contalo en el grupo.',
};

/**
 * Los rechazos que escribe la validación, en español y sin devolver lo que se escribió.
 *
 * ═══ Qué se rompía ═══
 *
 * Cuando un esquema rechaza algo sin un mensaje propio, la frase la pone la biblioteca de
 * validación — y esa frase está en inglés y habla de tipos. Una prueba contra producción pidió
 * ocho rutas con datos mal formados y recibió, tal cual, en el campo que la pantalla muestra:
 * «Unrecognized key: foo», «Invalid input: expected string, received undefined», «Too small:
 * expected string to have >=1 characters».
 *
 * Son tres problemas a la vez, no uno. Está en inglés, en una plataforma que sólo habla español.
 * Habla de tipos y de claves, que es exactamente la jerga que ADR-0041 saca de la pantalla. Y la
 * primera **devuelve el dato que llegó**, que es una forma discreta de reflejar entrada ajena en
 * una respuesta.
 *
 * ═══ Por qué acá y no en el manejador de errores HTTP ═══
 *
 * Porque el manejador no puede distinguir un mensaje puesto a mano —`z.string().min(3, 'Escribí al
 * menos tres letras.')`, de los que este repositorio tiene decenas y son buenos— de uno inventado
 * por la biblioteca. Elegir entre los dos por el aspecto del texto sería adivinar. Puesto acá, el
 * mensaje nace en español; los que alguien escribió a mano siguen ganando, porque un mensaje
 * propio tiene prioridad sobre este mapa.
 *
 * Se aplica al importar el paquete, sin que nadie tenga que acordarse de llamar a nada: una regla
 * que hay que recordar es una regla que se olvida, y el día que se olvide vuelve el inglés.
 */
function loQueSeEsperaba(esperado: unknown): string {
  switch (esperado) {
    case 'string':
      return 'Acá va texto.';
    case 'number':
    case 'bigint':
      return 'Acá va un número.';
    case 'boolean':
      return 'Acá se responde que sí o que no.';
    case 'array':
      return 'Acá va una lista.';
    case 'object':
      return 'Acá van varios datos juntos, no uno solo.';
    case 'date':
      return 'Acá va una fecha.';
    default:
      return 'Esto no tiene la forma que se espera acá.';
  }
}

/** «al menos 3 caracteres» / «al menos 1 elemento» — con el número que de verdad se pide. */
function cuantoFalta(minimo: unknown, origen: unknown): string {
  const cantidad = typeof minimo === 'bigint' ? Number(minimo) : minimo;
  if (typeof cantidad !== 'number') return 'Falta contenido acá.';
  const entero = String(Math.ceil(cantidad));
  if (origen === 'string') {
    return cantidad <= 1 ? 'Esto no puede quedar vacío.' : `Escribí al menos ${entero} caracteres.`;
  }
  if (origen === 'array' || origen === 'set') {
    return cantidad <= 1 ? 'Elegí al menos uno.' : `Elegí al menos ${entero}.`;
  }
  return `Tiene que ser ${entero} o más.`;
}

function cuantoSobra(maximo: unknown, origen: unknown): string {
  const cantidad = typeof maximo === 'bigint' ? Number(maximo) : maximo;
  if (typeof cantidad !== 'number') return 'Esto es más largo de lo que cabe acá.';
  const entero = String(Math.floor(cantidad));
  if (origen === 'string') return `No entran más de ${entero} caracteres.`;
  if (origen === 'array' || origen === 'set') return `No se pueden elegir más de ${entero}.`;
  return `Tiene que ser ${entero} o menos.`;
}

z.config({
  customError: (issue): string => {
    const dato = issue as unknown as Record<string, unknown>;
    switch (issue.code) {
      case 'invalid_type':
        return issue.input === undefined ? 'Falta este dato.' : loQueSeEsperaba(dato['expected']);
      case 'too_small':
        return cuantoFalta(dato['minimum'], dato['origin']);
      case 'too_big':
        return cuantoSobra(dato['maximum'], dato['origin']);
      case 'unrecognized_keys':
        // A propósito NO se dice cuál: nombrarla sería devolver en la respuesta lo que llegó en la
        // petición, y quien manda un dato de más no necesita que se lo lean de vuelta.
        return 'Llegó un dato que esta operación no espera. Revisá el formulario y mandá otra vez.';
      case 'invalid_value':
        return 'Ese valor no es uno de los que se admiten acá. Elegí uno de los que ofrece la pantalla.';
      case 'invalid_format':
        return 'El formato no es el que se espera acá. Revisá cómo está escrito.';
      case 'invalid_union':
        return 'Esto no encaja con ninguna de las formas que se admiten acá.';
      case 'not_multiple_of':
        return 'Ese número no sirve acá: tiene que ir de a pasos exactos.';
      default:
        return 'Este dato no tiene la forma que se espera acá.';
    }
  },
});

/** Frase para un código. Si el código es desconocido, se devuelve una frase honesta, no el código. */
export function mensajeDe(codigo: string, respaldo?: string): string {
  return (
    MENSAJES[codigo] ??
    respaldo ??
    'No pudimos completar esa acción y no se escribió nada. Volvé a cargar la pantalla y probá otra ' +
      'vez; si vuelve a pasar, contalo en el historial del grupo.'
  );
}
