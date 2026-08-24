#!/usr/bin/env node
/* global fetch, URL */
/**
 * Siembra de datos de ejemplo para DESARROLLO.
 *
 * ═══ Por qué existe ═══
 *
 * La plataforma en producción está vacía y el rediseño de la interfaz se está probando contra listas
 * vacías: la portada del primer día se ve siempre, pero las pantallas difíciles —votar, deliberar,
 * mis tareas, el resultado de una decisión— no se pueden ni mirar porque no hay datos ni sesión. Un
 * rediseño que sólo se prueba con listas vacías es un rediseño a ciegas.
 *
 * Este script llena una instancia LOCAL de desarrollo con un conjunto de personas, problemas,
 * deliberaciones, decisiones e iniciativas suficiente para ver la aplicación en casi todos sus
 * estados. Habla con la API **por HTTP**, exactamente como lo haría una persona desde el navegador o
 * `curl`: no escribe una sola fila en la base de datos por detrás. Si una regla del dominio impide
 * algo, este script se entera de la misma manera que se enteraría cualquiera, y lo dice.
 *
 * ═══ Cómo se usa ═══
 *
 *   1. Levantá el entorno de desarrollo con `pnpm dev` (ver `scripts/dev.mjs`). Antes de arrancarlo,
 *      exportá dos variables — si no las ponés, el script igual siembra lo que pueda y te dice
 *      exactamente qué se quedó a medias y por qué:
 *
 *        export KOINONIA_FACILITADORES=juliana.tobon@udea.edu.co
 *        export KOINONIA_VAULT_MASTER_KEY="$(openssl rand -base64 32)"
 *
 *      La primera le da el encargo de facilitación a una de las siete personas de este script —sin
 *      eso nadie puede abrir una deliberación, abrir una votación ni planear un hito, porque esas
 *      acciones las autoriza el dominio por ROL y el rol de facilitación no lo concede ninguna ruta
 *      HTTP: lo concede esta variable de entorno al arrancar el servicio (ver
 *      `services/api/src/http/adapters.ts`, `udeaIdentityAdapter`). La segunda habilita la bóveda que
 *      cifra la capacidad privada y la evidencia restringida de tareas; sin ella esas dos pantallas
 *      contestan 503 en desarrollo, tal como contestarían en producción sin su llave — es una
 *      protección real, no un capricho del script.
 *
 *   2. Con el entorno arriba (por defecto en http://127.0.0.1:3001), corré:
 *
 *        node scripts/sembrar-desarrollo.mjs
 *
 *      Podés apuntar a otro puerto local con `KOINONIA_API_URL=http://127.0.0.1:PUERTO`.
 *
 *   3. Volvé a correrlo cuando quieras. Cada paso comprueba primero si lo que va a crear ya existe
 *      (por título, por relación con su problema o su decisión, por estado ya alcanzado) y si es así
 *      no repite la escritura. Correrlo dos veces no deja el doble de nada. Lo único con un límite
 *      real es `/auth/enlace`: cinco pedidos por hora y por correo (`REGLA_ENLACE`); este script pide
 *      uno por cuenta y por corrida, así que aguanta varias corridas seguidas dentro de la misma hora
 *      antes de toparse con ese límite.
 *
 * ═══ Por qué hace falta correrlo MÁS de una vez para ver todo — y por qué «la iniciativa con sus
 *     tareas» es un hallazgo, no algo que este script entregue en un rato ═══
 *
 * Cerrar una votación exige que su propio plazo haya vencido de verdad (mínimo una hora: es el
 * mínimo que acepta `duracionHoras` en `abrirDecision`), y no hay ningún endpoint que adelante el
 * reloj del servidor —ni en este proyecto ni sería razonable que lo hubiera: un servidor de
 * gobernanza cuyo reloj se puede adelantar por HTTP es un servidor cuyo plazo de votación no protege
 * nada—. Este script abre una decisión con el plazo mínimo (una hora) y, en cada corrida, revisa si
 * ya venció; si es así, la cierra. Así que:
 *
 *   · La PRIMERA corrida deja una decisión abierta con plazo corto y otra con plazo largo, la
 *     deliberación en cada una de sus seis etapas, los problemas, las propuestas y las cuentas.
 *   · Corriéndolo de nuevo pasada esa hora, la decisión de plazo corto aparece CERRADA con su
 *     resultado, y (con los votos que este script emite) sale aprobada.
 *
 * Hasta ahí llega este script en un rato. Lo que NO alcanza —y es un hallazgo real del dominio, no
 * un hueco de esta siembra— es la pantalla de «una iniciativa con tareas ofrecidas, aceptadas y
 * entregadas»: cerrar una decisión aprobada crea la iniciativa, pero la deja **provisional**
 * (`activa: false`), y `planificarHito` / `ofrecerTarea` la rechazan de plano mientras siga así
 * —`INITIATIVE_NOT_ACTIVE`, ver `packages/domain/src/workspace/initiative.ts`, función
 * `requireActive`—. Lo único que la activa es `POST /decisiones/:id/ratificar`, y ratificar exige
 * además que haya pasado la **ventana de impugnación completa: 72 horas reales después del cierre**
 * (`DEFAULT_CHALLENGE_WINDOW_MS`, exigida en `packages/domain/src/engine.ts`, el `DecisionRatified`
 * de la línea 719). Sumado al plazo mínimo de apertura, son **unas 73 horas reales, mínimo**, desde
 * que este script abre la decisión hasta que puede haber una sola tarea. Este script SÍ intenta
 * ratificar (y sembrar el hito y las cuatro tareas) en cada corrida, por si alguien de verdad deja
 * pasar esos tres días — es correcto, sólo que no es el flujo con el que hay que contar para «mirar
 * la aplicación ahora». Escribir la ratificación o la iniciativa activa a mano en la base para
 * saltarse esa espera sería mentir sobre lo que el sistema garantiza (que nadie apura una ventana de
 * impugnación), así que este script no lo hace: si necesitás ver esas pantallas hoy mismo, hace falta
 * una decisión humana explícita de saltarse esta regla en un entorno de prueba, tomada por quien
 * pueda responder por qué — no algo que un script de siembra decida solo.
 *
 * ═══ Qué NO siembra, y por qué ═══
 *
 *   · El círculo «Académico» se queda sin nada. El adaptador de identidad del MVP matricula a toda
 *     persona nueva en Asamblea y en Espacios y Bienestar únicamente (`udeaIdentityAdapter`, opción
 *     `circulos` no usada en `server.ts`); nadie queda inscrito en Académico, así que nadie puede
 *     abrir una deliberación ni una decisión ahí (esas acciones exigen pertenecer al círculo). No es
 *     un hueco de esta siembra: es del arranque del propio servicio, y sembrar contenido en un
 *     círculo que nadie puede tramitar sería peor que dejarlo vacío.
 *   · La constitución digital (`/normas` y sus reformas) no se toca: no está entre las pantallas
 *     difíciles que pidió el encargo y es un subsistema aparte con su propio ciclo de firmas.
 *   · Las delegaciones de voto quedan sin usar a propósito: son una de las dos pantallas vacías
 *     deliberadas de esta siembra (la otra es «Mis tareas» de María, que nunca recibe un encargo).
 *
 * ═══ Quiénes quedan sembrados ═══
 *
 * Siete cuentas @udea.edu.co, para que las pantallas de varias voces se vean con varias voces de
 * verdad y no con una sola persona hablando sola:
 *
 *   juliana.tobon    facilitadora (requiere KOINONIA_FACILITADORES, ver arriba)
 *   camilo.zapata    jornada nocturna; escribe el problema de la sala de estudio y termina
 *                    encargado de la iniciativa que sale de ahí
 *   laura.pelaez     lleva una tarea del ofrecimiento hasta la entrega
 *   andres.moreno    acepta una tarea y la deja en curso, sin entregar
 *   valentina.ruiz   vota, delibera, pero su tarea se queda ofrecida sin responder
 *   santiago.uribe   objeta una decisión y rechaza una tarea
 *   maria.arboleda   activa en su propio problema, pero no recibe ninguna tarea: su «Mis tareas»
 *                    es la pantalla vacía de una persona que sí entró pero a la que no le tocó nada
 *
 * En desarrollo no hace falta servidor de correo: cada enlace de entrada viaja en la propia
 * respuesta de `/auth/enlace` (`enlaceDeDesarrollo`) y este script lo usa para entrar sin que nadie
 * tenga que leer una bandeja. El resumen final imprime, para cada cuenta, un enlace fresco por si
 * querés entrar vos mismo desde el navegador.
 */

import { randomUUID } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Guardia: esto NO corre contra nada que no sea local. De verdad, no con un comentario.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const API_BASE = (process.env.KOINONIA_API_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/u, '');

function exigirLocal(url) {
  let analizada;
  try {
    analizada = new URL(url);
  } catch {
    console.error(`No pude interpretar «${url}» como una URL. Me niego a continuar.`);
    process.exit(1);
  }
  const host = analizada.hostname.toLowerCase();
  const esLoopback =
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.test(host);
  if (!esLoopback) {
    console.error(
      `Me niego a correr contra «${url}»: el anfitrión «${host}» no es local (localhost/127.0.0.1).\n` +
        `Este script escribe datos de ejemplo con requestId y correos inventados; apuntado a algo que\n` +
        `no sea tu máquina, eso es un incidente. Si de verdad querés correrlo contra otra cosa, no lo\n` +
        `hagas — este script es sólo para desarrollo local.`,
    );
    process.exit(1);
  }
}
exigirLocal(API_BASE);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Transporte HTTP mínimo
// ═══════════════════════════════════════════════════════════════════════════════════════════════

function rid() {
  return randomUUID();
}

// Qué paso está corriendo el script en este momento — lo actualiza `marcarPaso` en cada fase de
// `main` (y en el bucle de cada persona/problema/deliberación/etc.) y lo lee `api` para que CUALQUIER
// petición que falle diga en qué parte del guion se rompió, no sólo qué ruta llamó.
let pasoActual = 'arranque (antes de la fase 1)';
function marcarPaso(nombre) {
  pasoActual = nombre;
}

/** Recorta un cuerpo de petición/respuesta para que el mensaje de error siga siendo legible. */
function resumirParaError(valor) {
  if (valor === undefined) return '(sin cuerpo)';
  const texto = JSON.stringify(valor);
  return texto.length > 400 ? `${texto.slice(0, 400)}…` : texto;
}

async function api(metodo, ruta, { token, body } = {}) {
  const cabeceras = { 'content-type': 'application/json' };
  if (token !== undefined) cabeceras.authorization = `Bearer ${token}`;
  let respuesta;
  try {
    respuesta = await fetch(`${API_BASE}${ruta}`, {
      method: metodo,
      headers: cabeceras,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (causa) {
    const error = new Error(
      `No pude conectar con ${metodo} ${API_BASE}${ruta} [paso: ${pasoActual}]. ¿Está corriendo ` +
        `\`pnpm dev\`? (${causa.message})`,
    );
    error.causa = causa;
    throw error;
  }
  const texto = await respuesta.text();
  const cuerpo = texto.length > 0 ? JSON.parse(texto) : undefined;
  if (!respuesta.ok) {
    const detalle = cuerpo?.mensaje ?? cuerpo?.codigo ?? (texto || respuesta.statusText);
    const error = new Error(
      `${metodo} ${ruta} → ${respuesta.status}: ${detalle} ` +
        `[paso: ${pasoActual}] [pedí: ${resumirParaError(body)}] [recibí: ${resumirParaError(cuerpo)}]`,
    );
    error.estado = respuesta.status;
    error.codigo = cuerpo?.codigo;
    error.cuerpo = cuerpo;
    throw error;
  }
  return cuerpo;
}

/** Corre `fn`; si falla, avisa en una línea y sigue. Para que un tramo caído no tumbe todo lo demás. */
async function intentar(descripcion, fn) {
  try {
    return await fn();
  } catch (error) {
    console.warn(`  ⚠ ${descripcion}: ${error.codigo ? `${error.codigo} — ` : ''}${error.message}`);
    return undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Sesión: cada persona entra por el mismo camino que usaría en el navegador
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function entrarComo(correo) {
  const enlace = await api('POST', '/auth/enlace', { body: { correo } });
  if (enlace.enlaceDeDesarrollo === undefined) {
    throw new Error(
      `/auth/enlace no devolvió un enlace de desarrollo para ${correo}. Este script exige el modo ` +
        `de desarrollo (NODE_ENV distinto de "production"); si eso está bien puesto, revisá que no ` +
        `haya un KOINONIA_SMTP_HOST configurado por error.`,
    );
  }
  const token = new URL(enlace.enlaceDeDesarrollo).searchParams.get('token');
  const sesion = await api('POST', '/auth/sesion', { body: { token } });
  return {
    correo,
    testigo: sesion.testigo,
    miembroId: sesion.miembroId,
    alias: sesion.alias,
    roles: sesion.roles,
    circulos: sesion.circulos,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// El elenco
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const ROSTER = [
  { clave: 'juliana', correo: 'juliana.tobon@udea.edu.co' },
  { clave: 'camilo', correo: 'camilo.zapata@udea.edu.co' },
  { clave: 'laura', correo: 'laura.pelaez@udea.edu.co' },
  { clave: 'andres', correo: 'andres.moreno@udea.edu.co' },
  { clave: 'valentina', correo: 'valentina.ruiz@udea.edu.co' },
  { clave: 'santiago', correo: 'santiago.uribe@udea.edu.co' },
  { clave: 'maria', correo: 'maria.arboleda@udea.edu.co' },
];

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Círculos: se leen, no se inventan sus identificadores
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function circulosPorNombre() {
  const lista = await api('GET', '/circulos');
  return new Map(lista.map((c) => [c.nombre, c.id]));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Problemas, evidencia y «me pasa lo mismo» — idempotentes por título
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function aseguraProblema(actor, { titulo, cuerpo, circuloId }) {
  const existentes = await api('GET', '/problemas');
  const previo = existentes.find((p) => p.titulo === titulo);
  if (previo !== undefined) return previo.id;
  const creado = await api('POST', '/problemas', {
    token: actor.testigo,
    body: { requestId: rid(), titulo, cuerpo, circuloId },
  });
  console.log(`  + problema «${titulo}»`);
  return creado.id;
}

async function aseguraEvidencia(actor, problemaId, { certeza, cuerpo, fuente }) {
  const detalle = await api('GET', `/problemas/${problemaId}`, { token: actor.testigo });
  if (detalle.evidencias.some((e) => e.cuerpo === cuerpo)) return;
  await api('POST', `/problemas/${problemaId}/evidencia`, {
    token: actor.testigo,
    body: { requestId: rid(), certeza, cuerpo, ...(fuente === undefined ? {} : { fuente }) },
  });
  console.log(`    + evidencia de ${actor.alias}`);
}

async function aseguraMePasaLoMismo(actor, problemaId) {
  const detalle = await api('GET', `/problemas/${problemaId}`, { token: actor.testigo });
  if (detalle.yaDijeQueMePasa) return;
  await api('POST', `/problemas/${problemaId}/me-pasa`, {
    token: actor.testigo,
    body: { requestId: rid() },
  });
  console.log(`    + «me pasa lo mismo» de ${actor.alias}`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Propuestas — idempotentes por título dentro del problema
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function aseguraPropuesta(actor, problemaId, { titulo, cuerpo, plan }) {
  const existentes = await api('GET', `/propuestas?problema=${problemaId}`);
  const previa = existentes.find((p) => p.titulo === titulo);
  if (previa !== undefined) return previa.id;
  const creada = await api('POST', '/propuestas', {
    token: actor.testigo,
    body: { requestId: rid(), problemaId, titulo, cuerpo, plan },
  });
  console.log(`  + propuesta «${titulo}»`);
  return creada.id;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Deliberación: abrir, aportar y avanzar de etapa, todo idempotente
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const ETAPAS = [
  'preguntas_aclaratorias',
  'perspectivas',
  'construccion_alternativas',
  'objeciones',
  'enmiendas',
  'listo_para_decidir',
];

async function verDeliberacion(id, actor) {
  return api('GET', `/deliberaciones/${id}`, { token: actor?.testigo });
}

async function aseguraDeliberacion(facilitadora, problemaId, duracionHoras) {
  const existentes = await api('GET', `/deliberaciones?problema=${problemaId}`);
  if (existentes.length > 0) return existentes[0].id;
  const abierta = await api('POST', '/deliberaciones', {
    token: facilitadora.testigo,
    body: { requestId: rid(), problemaId, duracionHoras },
  });
  console.log(`  + deliberación abierta sobre el problema ${problemaId}`);
  return abierta.id;
}

/**
 * El campo con el que se compara un aporte de entrada contra uno de salida.
 *
 * Cinco de los seis tipos de aporte se escriben con un campo `texto`, y el servidor lo devuelve tal
 * cual (`aporteDeliberacion.texto`, en `packages/contracts/src/http.ts`). El sexto, `riesgo`, NO
 * lleva `texto` al escribir —lleva `impacto` y `mitigacion`— pero el servidor SÍ devuelve `texto` en
 * la respuesta: lo llena con el `impacto` (ver `textoDelAporte` en
 * `services/api/src/http/presenters.ts`). Comparar `cuerpo.texto` (siempre `undefined` para un
 * riesgo) contra el `texto` de salida (nunca `undefined`) no empataba jamás: por eso el script
 * fallaba con `Cannot read properties of undefined (reading 'id')` al llegar a la primera objeción, y
 * de paso creaba un riesgo duplicado en cada corrida en vez de reconocer el que ya existía.
 */
function textoDeContraste(cuerpo) {
  return cuerpo.tipo === 'riesgo' ? cuerpo.impacto : cuerpo.texto;
}

async function aseguraAporte(deliberacionId, actor, cuerpo) {
  const detalle = await verDeliberacion(deliberacionId, actor);
  const textoEsperado = textoDeContraste(cuerpo);
  const previo = detalle.aportes.find((a) => a.tipo === cuerpo.tipo && a.texto === textoEsperado);
  if (previo !== undefined) return previo.id;
  const res = await api('POST', `/deliberaciones/${deliberacionId}/aportes`, {
    token: actor.testigo,
    body: { requestId: rid(), ...cuerpo },
  });
  const creado = [...res.aportes]
    .reverse()
    .find((a) => a.tipo === cuerpo.tipo && a.texto === textoEsperado);
  if (creado === undefined) {
    throw new Error(
      `Acabo de crear un aporte (${cuerpo.tipo}) de ${actor.alias} en la deliberación ` +
        `${deliberacionId} [paso: ${pasoActual}], pero no lo encuentro de vuelta en la respuesta de ` +
        `POST /deliberaciones/${deliberacionId}/aportes. Busqué tipo=«${cuerpo.tipo}» ` +
        `texto=«${textoEsperado}» entre ${res.aportes.length} aportes devueltos: ` +
        `${res.aportes.map((a) => `[${a.tipo}] ${a.texto}`).join(' | ') || '(ninguno)'}`,
    );
  }
  console.log(`    + aporte (${cuerpo.tipo}) de ${actor.alias}`);
  return creado.id;
}

async function aseguraEtapa(deliberacionId, facilitadora, etapaObjetivo) {
  let detalle = await verDeliberacion(deliberacionId, facilitadora);
  const objetivoIdx = ETAPAS.indexOf(etapaObjetivo);
  while (ETAPAS.indexOf(detalle.etapa) < objetivoIdx) {
    await api('POST', `/deliberaciones/${deliberacionId}/etapa`, {
      token: facilitadora.testigo,
      body: { requestId: rid() },
    });
    detalle = await verDeliberacion(deliberacionId, facilitadora);
    console.log(`    → etapa avanzada a «${detalle.etapa}»`);
  }
  return detalle;
}

/**
 * Siembra una deliberación completa: la abre si hace falta, va agregando el contenido de cada etapa
 * (con las referencias cruzadas que pide `armar`) y avanza hasta la etapa objetivo, sin repetir nada
 * que ya esté.
 */
async function sembrarDeliberacion(facilitadora, problemaId, { duracionHoras, objetivo, etapas }) {
  marcarPaso(`fase 4: deliberación del problema ${problemaId} — abriéndola/leyéndola`);
  const id = await aseguraDeliberacion(facilitadora, problemaId, duracionHoras);
  const ids = {};
  const objetivoIdx = ETAPAS.indexOf(objetivo);
  for (let i = 0; i <= objetivoIdx; i++) {
    const etapa = ETAPAS[i];
    for (const especificacion of etapas[etapa] ?? []) {
      marcarPaso(`fase 4: deliberación ${id} (problema ${problemaId}), etapa «${etapa}»`);
      const cuerpo = especificacion.armar(ids);
      const aporteId = await aseguraAporte(id, especificacion.actor, cuerpo);
      if (especificacion.clave !== undefined) ids[especificacion.clave] = aporteId;
    }
    if (i < objetivoIdx) {
      marcarPaso(
        `fase 4: deliberación ${id} (problema ${problemaId}) — avanzando a «${ETAPAS[i + 1]}»`,
      );
      await aseguraEtapa(id, facilitadora, ETAPAS[i + 1]);
    }
  }
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Decisiones: abrir, votar, y cerrar sólo cuando el plazo de verdad venció
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function aseguraDecision(
  facilitadora,
  propuestaId,
  tituloEsperado,
  { metodo, duracionHoras },
) {
  const existentes = await api('GET', '/decisiones');
  const previa = existentes.find((d) => d.titulo === tituloEsperado);
  if (previa !== undefined) return previa.id;
  const abierta = await api('POST', '/decisiones', {
    token: facilitadora.testigo,
    body: { requestId: rid(), propuestaId, metodo, duracionHoras },
  });
  console.log(`  + decisión abierta «${tituloEsperado}» (${metodo}, ${duracionHoras}h)`);
  return abierta.id;
}

async function aseguraVoto(actor, decisionId, respuesta) {
  const detalle = await api('GET', `/decisiones/${decisionId}`, { token: actor.testigo });
  if (detalle.yaVotaste) return;
  if (!detalle.puedoDecidir) {
    console.warn(
      `  ⚠ ${actor.alias} no puede votar esta decisión: ${detalle.motivoNoPuedo ?? 'sin motivo'}`,
    );
    return;
  }
  await api('POST', `/decisiones/${decisionId}/papeletas`, {
    token: actor.testigo,
    body: { requestId: rid(), huellaVersion: detalle.huellaVersion, respuesta },
  });
  console.log(`    + voto de ${actor.alias}`);
}

/** Cierra la decisión si su plazo ya venció. Devuelve el resultado, o `undefined` si sigue abierta. */
async function cierraSiVencio(facilitadora, decisionId) {
  const resumen = await api('GET', `/decisiones/${decisionId}`);
  if (resumen.estado !== 'Open') {
    // Ya cerrada (de esta corrida o de una anterior): recuperamos el resultado igual.
    if (
      resumen.estado === 'Closed' ||
      resumen.estado === 'Tallied' ||
      resumen.estado === 'Ratified'
    ) {
      return api('GET', `/decisiones/${decisionId}/resultado`);
    }
    return undefined;
  }
  if (Date.now() < resumen.cierraEn) {
    const faltan = Math.ceil((resumen.cierraEn - Date.now()) / 60000);
    console.log(
      `  … «${resumen.titulo}» todavía no vence (faltan ~${faltan} min); correlo de nuevo después.`,
    );
    return undefined;
  }
  const resultado = await api('POST', `/decisiones/${decisionId}/cerrar`, {
    token: facilitadora.testigo,
    body: { requestId: rid() },
  });
  console.log(`  ✓ «${resumen.titulo}» cerrada: ${resultado.desenlaceEnPalabras}`);
  return resultado;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Capacidad privada — requiere KOINONIA_VAULT_MASTER_KEY; se degrada con aviso si no está
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function aseguraCapacidad(actor, minutosPorSemana) {
  const actual = await api('GET', '/mi/capacidad', { token: actor.testigo });
  if (actual.declarada) return;
  await api('PUT', '/mi/capacidad', {
    token: actor.testigo,
    body: { revision: 0, minutosPorSemana },
  });
  console.log(`  + capacidad declarada por ${actor.alias} (${minutosPorSemana} min/semana)`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Iniciativa: hitos y tareas — sólo existe una vez que una decisión cerró aprobada
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function buscaIniciativaDeDecision(decisionId) {
  const lista = await api('GET', '/iniciativas');
  return lista.find((i) => i.decisionId === decisionId);
}

async function aseguraHito(responsable, iniciativaId, { titulo, criterioDeTerminacion, venceEn }) {
  const detalle = await api('GET', `/iniciativas/${iniciativaId}`);
  const previo = detalle.hitos.find((h) => h.titulo === titulo);
  if (previo !== undefined) return previo.id;
  const actualizada = await api('POST', `/iniciativas/${iniciativaId}/hitos`, {
    token: responsable.testigo,
    body: { requestId: rid(), titulo, criterioDeTerminacion, venceEn },
  });
  const creado = actualizada.hitos.find((h) => h.titulo === titulo);
  if (creado === undefined) {
    throw new Error(
      `Acabo de crear el hito «${titulo}» en la iniciativa ${iniciativaId} [paso: ${pasoActual}], ` +
        `pero no aparece en la respuesta de POST /iniciativas/${iniciativaId}/hitos (trajo ` +
        `${actualizada.hitos.length} hitos: ${actualizada.hitos.map((h) => h.titulo).join(' | ') || '(ninguno)'}).`,
    );
  }
  console.log(`  + hito «${titulo}»`);
  return creado.id;
}

async function aseguraOfertaTarea(
  responsable,
  iniciativaId,
  hitoId,
  destinatario,
  { titulo, descripcion, venceEn, esfuerzoMinutos },
) {
  const detalle = await api('GET', `/iniciativas/${iniciativaId}`);
  const previa = detalle.tareas.find((t) => t.titulo === titulo);
  if (previa !== undefined) return previa;
  const actualizada = await api('POST', `/iniciativas/${iniciativaId}/tareas`, {
    token: responsable.testigo,
    body: {
      requestId: rid(),
      hitoId,
      destinatarioId: destinatario.miembroId,
      titulo,
      descripcion,
      venceEn,
      esfuerzoMinutos,
      dependeDe: [],
    },
  });
  const creada = actualizada.tareas.find((t) => t.titulo === titulo);
  if (creada === undefined) {
    throw new Error(
      `Acabo de ofrecer la tarea «${titulo}» en la iniciativa ${iniciativaId} [paso: ${pasoActual}], ` +
        `pero no aparece en la respuesta de POST /iniciativas/${iniciativaId}/tareas (trajo ` +
        `${actualizada.tareas.length} tareas: ${actualizada.tareas.map((t) => t.titulo).join(' | ') || '(ninguna)'}).`,
    );
  }
  console.log(`  + tarea ofrecida «${titulo}» → ${destinatario.alias}`);
  return creada;
}

function tareaDe(detalle, titulo) {
  return detalle.tareas.find((t) => t.titulo === titulo);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// main
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`Sembrando desarrollo contra ${API_BASE}\n`);
  marcarPaso('comprobación de salud (GET /salud)');
  await api('GET', '/salud');

  // ── Fase 1: cuentas ──────────────────────────────────────────────────────────────────────────
  marcarPaso('fase 1: cuentas (Personas)');
  console.log('Personas');
  const P = {};
  for (const { clave, correo } of ROSTER) {
    marcarPaso(`fase 1: cuentas — entrando como ${correo}`);
    P[clave] = await entrarComo(correo);
    console.log(`  · ${P[clave].alias} (${P[clave].roles.join(', ')})`);
  }
  const facilitadoraOk = P.juliana.roles.includes('facilitator');
  if (!facilitadoraOk) {
    console.warn(
      '\n⚠ juliana.tobon no tiene el rol de facilitación. Todo lo que exige abrir una fase, una\n' +
        '  votación o planear un hito va a fallar y quedará avisado abajo, uno por uno. Para\n' +
        '  arreglarlo: pará `pnpm dev`, exportá\n' +
        '    KOINONIA_FACILITADORES=juliana.tobon@udea.edu.co\n' +
        '  y volvé a levantarlo antes de correr este script otra vez.\n',
    );
  }

  // ── Fase 2: círculos ─────────────────────────────────────────────────────────────────────────
  const circulos = await circulosPorNombre();
  const ESPACIOS = circulos.get('Espacios y Bienestar');
  const ASAMBLEA = circulos.get('Asamblea del Instituto');
  if (ESPACIOS === undefined || ASAMBLEA === undefined) {
    throw new Error('No encontré los círculos esperados en GET /circulos; ¿cambió `circles.ts`?');
  }

  // ── Fase 3: problemas, evidencia y «me pasa lo mismo» ───────────────────────────────────────
  marcarPaso('fase 3: problemas, evidencia y «me pasa lo mismo»');
  console.log('\nProblemas');
  const probA = await aseguraProblema(P.camilo, {
    titulo: 'La sala de estudio cierra a las 6 y los de la nocturna no tenemos dónde leer.',
    cuerpo:
      'Salimos de clase después de las 6 de la tarde y la sala de estudio del bloque ya está ' +
      'cerrada. No hay dónde repasar antes de un parcial temprano ni dónde reunirse a terminar un ' +
      'trabajo en grupo. El vigilante se va a esa hora y bienestar no tiene turno nocturno asignado.',
    circuloId: ESPACIOS,
  });
  await aseguraEvidencia(P.laura, probA, {
    certeza: 'visto',
    cuerpo:
      'La semana pasada llegué a las 6:10 y ya estaban bajando la reja. Adentro quedaban al menos ' +
      'ocho personas que tuvieron que recoger e irse.',
  });
  await aseguraEvidencia(P.andres, probA, {
    certeza: 'me-lo-contaron',
    cuerpo:
      'Un compañero de la nocturna me contó que terminan la última clase a las 6:15 y para esa ' +
      'hora la sala ya lleva quince minutos cerrada.',
  });
  await aseguraMePasaLoMismo(P.laura, probA);
  await aseguraMePasaLoMismo(P.santiago, probA);

  const probB = await aseguraProblema(P.valentina, {
    titulo:
      'Los de primer semestre no sabemos qué leer ni en qué orden, y los PDF circulan por WhatsApp sin criterio.',
    cuerpo:
      'Cada profesor tiene su propia lista de lecturas dentro de su syllabus, pero no hay un lugar ' +
      'único donde verlas todas antes de matricular. Los PDF de años anteriores circulan por ' +
      'WhatsApp sin que se sepa si corresponden a la versión vigente del curso.',
    circuloId: ASAMBLEA,
  });
  await aseguraEvidencia(P.santiago, probB, {
    certeza: 'lo-supongo',
    cuerpo:
      'Supongo que si existiera una sola página con las lecturas de cada electiva por semestre, la ' +
      'mitad de esos grupos de WhatsApp de PDF sueltos dejarían de tener sentido.',
  });

  const probC = await aseguraProblema(P.laura, {
    titulo:
      'El comedor cierra antes de que salgamos de la última clase de la tarde y no alcanzamos a comer.',
    cuerpo:
      'La última clase de la tarde termina a las 5:45 y para cuando se llega al comedor ya está ' +
      'cerrando caja. Pasa varios días de la semana, no sólo ocasionalmente.',
    circuloId: ESPACIOS,
  });

  const probD = await aseguraProblema(P.andres, {
    titulo: 'Se decidió hacer una carta hace cuatro meses y nadie sabe si se escribió.',
    cuerpo:
      'La Asamblea aprobó hace un semestre enviar una carta sobre un asunto del Instituto. Desde ' +
      'entonces nadie ha vuelto a mencionarla ni hay ningún registro de si se envió, a quién, o qué ' +
      'contestaron.',
    circuloId: ASAMBLEA,
  });

  const probE = await aseguraProblema(P.santiago, {
    titulo: 'El reglamento de becas-trabajo salió sin que nadie del estudiantado lo revisara.',
    cuerpo:
      'Se publicó una nueva versión del reglamento de becas-trabajo y ningún representante ' +
      'estudiantil lo vio antes de que saliera. Varios artículos afectan directamente a quien ya ' +
      'tiene una beca-trabajo asignada este semestre.',
    circuloId: ASAMBLEA,
  });

  const probF = await aseguraProblema(P.maria, {
    titulo:
      'La convocatoria de monitorías quedó con un requisito que excluye a quienes trabajan medio tiempo.',
    cuerpo:
      'Las bases de la convocatoria de monitorías piden disponibilidad de mínimo 20 horas semanales ' +
      'en franja diurna. Quienes trabajamos medio tiempo en la tarde quedamos afuera aunque ' +
      'cumplamos con todo lo demás.',
    circuloId: ESPACIOS,
  });

  // ── Fase 4: deliberaciones, una por cada una de las seis etapas ─────────────────────────────
  console.log('\nDeliberaciones');

  await sembrarDeliberacion(P.juliana, probA, {
    duracionHoras: 240,
    objetivo: 'listo_para_decidir',
    etapas: {
      preguntas_aclaratorias: [
        {
          actor: P.andres,
          clave: 'pregunta',
          armar: () => ({
            tipo: 'posicion',
            modo: 'pregunta_aclaratoria',
            texto:
              '¿La sala está cerrada por una norma del bloque o porque bienestar no tiene a quién ' +
              'poner después de las 6?',
          }),
        },
        {
          actor: P.laura,
          armar: (ids) => ({
            tipo: 'razon',
            relacion: 'responde',
            posicionId: ids.pregunta,
            texto:
              'La cierran porque el vigilante del bloque sale a las 6 y bienestar no tiene turno ' +
              'nocturno asignado; no es una norma escrita en ningún lado.',
          }),
        },
      ],
      perspectivas: [
        {
          actor: P.camilo,
          clave: 'posturaNocturna',
          armar: () => ({
            tipo: 'posicion',
            modo: 'afirmacion',
            texto:
              'Quienes estudiamos en la jornada nocturna salimos después de las 6 y no tenemos ' +
              'dónde repasar antes de un parcial temprano al día siguiente.',
          }),
        },
        {
          actor: P.laura,
          clave: 'posturaDiurna',
          armar: () => ({
            tipo: 'posicion',
            modo: 'afirmacion',
            texto:
              'No es sólo la nocturna: los grupos de estudio de la diurna también se quedan sin ' +
              'sala cuando una asesoría se alarga después de las 6.',
          }),
        },
        {
          actor: P.santiago,
          armar: (ids) => ({
            tipo: 'razon',
            relacion: 'sostiene',
            posicionId: ids.posturaNocturna,
            texto:
              'En la última semana de parciales hice fila por una mesa del pasillo porque la sala ' +
              'ya estaba cerrada y no había dónde más sentarse a repasar.',
          }),
        },
      ],
      construccion_alternativas: [
        {
          actor: P.camilo,
          clave: 'alternativa',
          armar: (ids) => ({
            tipo: 'alternativa',
            problemaId: probA,
            saleDe: [ids.posturaNocturna, ids.posturaDiurna],
            texto:
              'Que bienestar universitario asigne un monitor que abra la sala hasta las 10 p.m. en ' +
              'las dos semanas de parciales de cada corte, con el rubro que ya existe para ' +
              'vigilancia de eventos.',
          }),
        },
      ],
      objeciones: [
        {
          actor: P.valentina,
          armar: (ids) => ({
            tipo: 'riesgo',
            salidaId: ids.alternativa,
            gravedad: 2,
            impacto:
              'Si el monitor falta un día la sala queda cerrada igual, y la gente termina ' +
              'confiando en un horario que no siempre se cumple.',
            mitigacion:
              'Publicar el horario real cada semana en la cartelera y en la web, en vez de prometer ' +
              'un horario fijo para todo el semestre.',
          }),
        },
      ],
      enmiendas: [
        {
          actor: P.camilo,
          // `saleDe` (sourcePositionIds) SIEMPRE exige aportes de tipo `posicion` — nunca del tipo
          // que se está corrigiendo (`assertReferences`/`ownReferences` en
          // `packages/domain/src/deliberation/graph.ts`, caso `alternativa`). `corrigeA` sí apunta a
          // la alternativa anterior; `saleDe` repite las mismas posturas de las que salió esa
          // alternativa, porque la enmienda sigue naciendo de esas posturas.
          armar: (ids) => ({
            tipo: 'alternativa',
            problemaId: probA,
            corrigeA: ids.alternativa,
            saleDe: [ids.posturaNocturna, ids.posturaDiurna],
            texto:
              'Igual que la anterior, pero el compromiso es sólo con las dos semanas de parciales de ' +
              'cada corte, y se avisa con una semana de anticipación si algún día no hay quién abra.',
          }),
        },
      ],
    },
  });

  await sembrarDeliberacion(P.juliana, probB, {
    duracionHoras: 240,
    objetivo: 'preguntas_aclaratorias',
    etapas: {
      preguntas_aclaratorias: [
        {
          actor: P.santiago,
          clave: 'pregunta',
          armar: () => ({
            tipo: 'posicion',
            modo: 'pregunta_aclaratoria',
            texto:
              '¿Ya existe una lista de lecturas por electiva en algún syllabus, o hay que armarla ' +
              'desde cero?',
          }),
        },
        {
          actor: P.valentina,
          armar: (ids) => ({
            tipo: 'razon',
            relacion: 'responde',
            posicionId: ids.pregunta,
            texto:
              'Cada profesor tiene su syllabus, pero no hay un lugar único donde verlos todos juntos ' +
              'antes de matricular.',
          }),
        },
      ],
    },
  });

  await sembrarDeliberacion(P.juliana, probC, {
    duracionHoras: 240,
    objetivo: 'perspectivas',
    etapas: {
      preguntas_aclaratorias: [
        {
          actor: P.andres,
          armar: () => ({
            tipo: 'posicion',
            modo: 'pregunta_aclaratoria',
            texto:
              '¿El comedor cierra por el horario del contrato de la cafetería o porque a esa hora ' +
              'ya no queda comida?',
          }),
        },
      ],
      perspectivas: [
        {
          actor: P.laura,
          clave: 'postura',
          armar: () => ({
            tipo: 'posicion',
            modo: 'afirmacion',
            texto:
              'Salgo de la última clase de la tarde a las 5:45 y cuando llego el comedor ya está ' +
              'cerrando caja.',
          }),
        },
        {
          actor: P.camilo,
          armar: (ids) => ({
            tipo: 'razon',
            relacion: 'sostiene',
            posicionId: ids.postura,
            texto: 'Lo mismo me pasa los martes y jueves con la última clase de electiva.',
          }),
        },
        {
          actor: P.santiago,
          armar: (ids) => ({
            tipo: 'supuesto',
            aplicaA: [ids.postura],
            texto:
              'Se está asumiendo que el problema es el horario y no que la fila tarda más de lo que ' +
              'dura el descanso entre clases.',
          }),
        },
      ],
    },
  });

  await sembrarDeliberacion(P.juliana, probD, {
    duracionHoras: 240,
    objetivo: 'construccion_alternativas',
    etapas: {
      preguntas_aclaratorias: [
        {
          actor: P.valentina,
          armar: () => ({
            tipo: 'posicion',
            modo: 'pregunta_aclaratoria',
            texto:
              '¿La carta se aprobó con un texto concreto o sólo se aprobó la idea de escribirla?',
          }),
        },
      ],
      perspectivas: [
        {
          actor: P.santiago,
          clave: 'postura',
          armar: () => ({
            tipo: 'posicion',
            modo: 'afirmacion',
            texto:
              'Se aprobó el envío en una asamblea, pero nadie volvió a mencionarlo desde entonces.',
          }),
        },
      ],
      construccion_alternativas: [
        {
          actor: P.andres,
          armar: (ids) => ({
            tipo: 'alternativa',
            problemaId: probD,
            saleDe: [ids.postura],
            texto:
              'Que quien coordinó la carta publique en la web del Instituto si se envió, con fecha, ' +
              'o diga qué falta si todavía no se envió.',
          }),
        },
      ],
    },
  });

  await sembrarDeliberacion(P.juliana, probE, {
    duracionHoras: 240,
    objetivo: 'objeciones',
    etapas: {
      preguntas_aclaratorias: [
        {
          actor: P.laura,
          armar: () => ({
            tipo: 'posicion',
            modo: 'pregunta_aclaratoria',
            texto:
              '¿El reglamento ya está en vigencia o todavía se puede pedir que lo revisen antes de ' +
              'aplicarlo?',
          }),
        },
      ],
      perspectivas: [
        {
          actor: P.camilo,
          clave: 'postura',
          armar: () => ({
            tipo: 'posicion',
            modo: 'afirmacion',
            texto: 'Ya salió publicado y nadie del estudiantado lo vio antes de que se publicara.',
          }),
        },
      ],
      construccion_alternativas: [
        {
          actor: P.santiago,
          clave: 'alternativa',
          armar: (ids) => ({
            tipo: 'alternativa',
            problemaId: probE,
            saleDe: [ids.postura],
            texto:
              'Pedir que toda reforma al reglamento de becas-trabajo pase por una lectura previa de ' +
              'dos semanas antes de publicarse.',
          }),
        },
      ],
      objeciones: [
        {
          actor: P.valentina,
          armar: (ids) => ({
            tipo: 'riesgo',
            salidaId: ids.alternativa,
            gravedad: 3,
            impacto:
              'Dos semanas de lectura previa pueden retrasar la convocatoria del semestre si ya ' +
              'viene ajustada al calendario académico.',
            mitigacion:
              'Que la lectura corra en paralelo con el trámite administrativo y no después de él.',
          }),
        },
      ],
    },
  });

  await sembrarDeliberacion(P.juliana, probF, {
    duracionHoras: 240,
    objetivo: 'enmiendas',
    etapas: {
      preguntas_aclaratorias: [
        {
          actor: P.camilo,
          armar: () => ({
            tipo: 'posicion',
            modo: 'pregunta_aclaratoria',
            texto:
              '¿El requisito de disponibilidad de tiempo completo está escrito en la convocatoria o ' +
              'lo están pidiendo verbalmente?',
          }),
        },
      ],
      perspectivas: [
        {
          actor: P.andres,
          clave: 'postura',
          armar: () => ({
            tipo: 'posicion',
            modo: 'afirmacion',
            texto:
              'Está escrito en las bases: piden disponibilidad de mínimo 20 horas semanales en ' +
              'franja diurna.',
          }),
        },
      ],
      construccion_alternativas: [
        {
          actor: P.laura,
          clave: 'alternativa',
          armar: (ids) => ({
            tipo: 'alternativa',
            problemaId: probF,
            saleDe: [ids.postura],
            texto:
              'Que la convocatoria acepte franjas nocturnas y de fin de semana para quienes ' +
              'trabajan medio tiempo.',
          }),
        },
      ],
      objeciones: [
        {
          actor: P.santiago,
          armar: (ids) => ({
            tipo: 'riesgo',
            salidaId: ids.alternativa,
            gravedad: 2,
            impacto:
              'Algunas monitorías necesitan coincidir con el horario de la oficina que las ' +
              'supervisa.',
            mitigacion:
              'Aclarar cuáles monitorías sí pueden ser en otra franja y cuáles no, en vez de ' +
              'cambiar la regla para todas por igual.',
          }),
        },
      ],
      enmiendas: [
        {
          actor: P.laura,
          // Ver la nota en la enmienda de `probA`: `saleDe` exige `posicion`, no la alternativa que
          // se corrige.
          armar: (ids) => ({
            tipo: 'alternativa',
            problemaId: probF,
            corrigeA: ids.alternativa,
            saleDe: [ids.postura],
            texto:
              'Igual que la anterior, pero sólo para las monitorías que no dependen de que la ' +
              'oficina esté abierta al mismo tiempo.',
          }),
        },
      ],
    },
  });

  // ── Fase 5: propuestas con plan de ejecución ────────────────────────────────────────────────
  marcarPaso('fase 5: propuestas con plan de ejecución');
  console.log('\nPropuestas');
  const en45dias = Date.now() + 45 * 24 * 60 * 60 * 1000;

  const propuestaA = await aseguraPropuesta(P.camilo, probA, {
    titulo: 'Ampliar el horario de la sala de estudio hasta las 10 p.m. en semana de parciales',
    cuerpo:
      'Que bienestar universitario asigne quien abra la sala de estudio hasta las 10 p.m. durante ' +
      'las dos semanas de parciales de cada corte, empezando por el bloque que más se usa en la ' +
      'jornada nocturna, con el rubro que ya existe para vigilancia de eventos.',
    plan: {
      objetivo:
        'Que la sala de estudio permanezca abierta hasta las 10 p.m. durante las semanas de ' +
        'parciales del semestre en curso.',
      responsableId: P.camilo.miembroId,
      revisarEn: en45dias,
      criteriosDeExito: [
        {
          descripcion:
            'La sala registra apertura hasta las 10 p.m. en las dos semanas de parciales de cada ' +
            'corte del semestre.',
          fuenteDeVerificacion: 'Bitácora de apertura y cierre que lleva bienestar universitario.',
        },
      ],
    },
  });

  const propuestaD = await aseguraPropuesta(P.andres, probD, {
    titulo: 'Publicar el estado de la carta que la Asamblea aprobó mandar hace un semestre',
    cuerpo:
      'Que quien coordinó el envío de la carta publique en la web del Instituto si se envió, con la ' +
      'fecha, o qué falta para enviarla si todavía no ha salido.',
    plan: {
      objetivo:
        'Que exista, en la web del Instituto, un registro público del estado de la carta aprobada ' +
        'por la Asamblea.',
      responsableId: P.andres.miembroId,
      revisarEn: en45dias,
      criteriosDeExito: [
        {
          descripcion:
            'La página de acuerdos del Instituto muestra la fecha de envío de la carta o, si no se ' +
            'envió, el motivo y la fecha en que se retomará.',
          fuenteDeVerificacion: 'La propia página publicada, con su fecha de última edición.',
        },
      ],
    },
  });

  // ── Fase 6: decisiones — una de plazo corto, otra de plazo largo ───────────────────────────
  marcarPaso('fase 6: decisiones y votos');
  console.log('\nDecisiones');
  const decisionA = await aseguraDecision(
    P.juliana,
    propuestaA,
    'Ampliar el horario de la sala de estudio hasta las 10 p.m. en semana de parciales',
    { metodo: 'simple-majority', duracionHoras: 1 },
  );
  await aseguraVoto(P.camilo, decisionA, { tipo: 'binary', aprueba: true });
  await aseguraVoto(P.laura, decisionA, { tipo: 'binary', aprueba: true });
  await aseguraVoto(P.andres, decisionA, { tipo: 'binary', aprueba: true });
  await aseguraVoto(P.santiago, decisionA, { tipo: 'binary', aprueba: true });
  await aseguraVoto(P.valentina, decisionA, { tipo: 'binary', aprueba: false });

  const decisionD = await aseguraDecision(
    P.juliana,
    propuestaD,
    'Publicar el estado de la carta que la Asamblea aprobó mandar hace un semestre',
    { metodo: 'sociocratic-consent', duracionHoras: 480 },
  );
  await aseguraVoto(P.camilo, decisionD, { tipo: 'consent', postura: 'consent' });
  await aseguraVoto(P.andres, decisionD, { tipo: 'consent', postura: 'consent' });
  await aseguraVoto(P.laura, decisionD, { tipo: 'consent', postura: 'concern' });
  await aseguraVoto(P.santiago, decisionD, {
    tipo: 'consent',
    postura: 'object',
    objecion: {
      argumento:
        'Publicar sólo la fecha de envío no dice si la carta llegó a quien debía llegarle ni si ' +
        'hubo respuesta; eso deja a la Asamblea sin saber si el problema de fondo se resolvió.',
      objetivoDanado: 'El seguimiento real de lo que la Asamblea decide, no sólo su registro.',
    },
  });

  // ── Fase 7: cerrar lo que ya venció; ratificar e iniciativa/tareas si además pasaron 72h más ──
  console.log(
    '\nCierre, y ratificación + iniciativa si el plazo (y luego la impugnación) vencieron',
  );
  marcarPaso('fase 7: cierre de la decisión de plazo corto, ratificación e iniciativa/tareas');
  await intentar('cerrar la decisión de plazo corto', async () => {
    const resultado = await cierraSiVencio(P.juliana, decisionA);
    if (resultado === undefined) return;
    if (resultado.desenlace !== 'approved') {
      console.log(`    (no salió aprobada: ${resultado.desenlaceEnPalabras}; no hay iniciativa)`);
      return;
    }

    const iniciativa =
      resultado.iniciativaId !== undefined
        ? { id: resultado.iniciativaId }
        : await buscaIniciativaDeDecision(decisionA);
    if (iniciativa === undefined) {
      console.warn('    ⚠ salió aprobada pero no encontré su iniciativa; raro, revisar a mano.');
      return;
    }

    // La iniciativa nace PROVISIONAL. Ni un hito ni una tarea existen antes de la ratificación, y
    // ratificar exige que hayan pasado 72 horas reales desde el cierre (la ventana de impugnación:
    // `DEFAULT_CHALLENGE_WINDOW_MS`, exigida en `packages/domain/src/engine.ts`). No hay atajo: se
    // intenta, y si el dominio la rechaza por prematura, este script lo dice y no sigue de largo.
    let detalleIniciativa = await api('GET', `/iniciativas/${iniciativa.id}`);
    if (!detalleIniciativa.activa) {
      const ratificacion = await intentar(
        'ratificar la decisión (sólo posible si ya pasaron 72h reales desde el cierre)',
        () =>
          api('POST', `/decisiones/${decisionA}/ratificar`, {
            token: P.juliana.testigo,
            body: { requestId: rid() },
          }),
      );
      if (ratificacion !== undefined) console.log('  ✓ decisión ratificada; iniciativa activada');
      detalleIniciativa = await api('GET', `/iniciativas/${iniciativa.id}`);
    }
    if (!detalleIniciativa.activa) {
      console.log(
        '    (la iniciativa sigue provisional: todavía no pasaron las 72 horas reales de ventana ' +
          'de impugnación desde el cierre. Sin ratificar, el dominio rechaza cualquier hito o tarea ' +
          '— INITIATIVE_NOT_ACTIVE. Corré este script otra vez pasado ese plazo.)',
      );
      return;
    }

    const hitoId = await aseguraHito(P.camilo, iniciativa.id, {
      titulo: 'Conseguir quién abra la sala en horario extendido durante parciales',
      criterioDeTerminacion:
        'Hay una persona o un turno asignado para abrir la sala hasta las 10 p.m. cada día de las ' +
        'dos semanas de parciales.',
      venceEn: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    await aseguraOfertaTarea(P.camilo, iniciativa.id, hitoId, P.laura, {
      titulo: 'Hablar con bienestar universitario para pedir el turno extendido',
      descripcion:
        'Conseguir una reunión con bienestar universitario, explicar el pedido de la Asamblea y ' +
        'traer por escrito qué necesitan para autorizar el turno hasta las 10 p.m.',
      venceEn: Date.now() + 10 * 24 * 60 * 60 * 1000,
      esfuerzoMinutos: 180,
    });
    await aseguraOfertaTarea(P.camilo, iniciativa.id, hitoId, P.andres, {
      titulo: 'Armar el horario real de apertura para publicar en la cartelera',
      descripcion:
        'Con la respuesta de bienestar, armar el horario semana a semana de quién abre la sala y ' +
        'dejarlo listo para publicar en la cartelera y en la web.',
      venceEn: Date.now() + 14 * 24 * 60 * 60 * 1000,
      esfuerzoMinutos: 90,
    });
    await aseguraOfertaTarea(P.camilo, iniciativa.id, hitoId, P.valentina, {
      titulo: 'Escribir el aviso para la cartelera y los grupos de WhatsApp',
      descripcion:
        'Redactar un aviso corto explicando el nuevo horario, para pegar en la cartelera del bloque ' +
        'y compartir en los grupos de WhatsApp de los semestres.',
      venceEn: Date.now() + 16 * 24 * 60 * 60 * 1000,
      esfuerzoMinutos: 45,
    });
    await aseguraOfertaTarea(P.camilo, iniciativa.id, hitoId, P.santiago, {
      titulo: 'Revisar si el aviso también debe salir en el boletín del Instituto',
      descripcion:
        'Confirmar con quien lleva el boletín si el nuevo horario de la sala alcanza a salir en la ' +
        'próxima edición.',
      venceEn: Date.now() + 7 * 24 * 60 * 60 * 1000,
      esfuerzoMinutos: 20,
    });

    // Capacidad declarada ANTES de aceptar: la acción de aceptar exige haberla revisado. Si la
    // bóveda no está configurada, la PRIMERA lectura ya lanza CAPACITY_SERVICE_UNAVAILABLE (503):
    // se detecta ahí y no se insiste con las demás personas.
    let bovedaDisponible = true;
    for (const persona of [P.juliana, P.camilo, P.laura, P.andres]) {
      if (!bovedaDisponible) break;
      try {
        await aseguraCapacidad(persona, 300);
      } catch (error) {
        if (error.codigo === 'CAPACITY_SERVICE_UNAVAILABLE') {
          bovedaDisponible = false;
        } else {
          console.warn(`  ⚠ declarar capacidad de ${persona.alias}: ${error.message}`);
        }
      }
    }
    if (!bovedaDisponible) {
      console.warn(
        '  ⚠ La bóveda de capacidad privada no está disponible (falta KOINONIA_VAULT_MASTER_KEY).\n' +
          '    Sin ella nadie puede ACEPTAR una tarea (la aceptación exige capacidad declarada) ni\n' +
          '    agregar evidencia restringida, así que las tareas se quedan todas en «ofrecida». Es\n' +
          '    la misma protección que en producción: no se inventa una capacidad en claro.',
      );
    }

    if (bovedaDisponible) {
      await intentar('que Laura acepte, inicie y entregue su tarea', async () => {
        let detalle = await api('GET', `/iniciativas/${iniciativa.id}`);
        let tarea = tareaDe(
          detalle,
          'Hablar con bienestar universitario para pedir el turno extendido',
        );
        if (tarea.estado === 'ofrecida') {
          await api('POST', `/iniciativas/${iniciativa.id}/tareas/${tarea.id}/respuestas`, {
            token: P.laura.testigo,
            body: {
              requestId: rid(),
              tipo: 'aceptar',
              offerId: tarea.ofertaId,
              revision: tarea.revision,
            },
          });
          console.log('    + Laura aceptó su tarea');
        }
        detalle = await api('GET', `/iniciativas/${iniciativa.id}`);
        tarea = tareaDe(
          detalle,
          'Hablar con bienestar universitario para pedir el turno extendido',
        );
        if (tarea.estado === 'aceptada') {
          await api('POST', `/iniciativas/${iniciativa.id}/tareas/${tarea.id}/iniciar`, {
            token: P.laura.testigo,
            body: { requestId: rid(), offerId: tarea.ofertaId, revision: tarea.revision },
          });
          console.log('    + Laura inició su tarea');
        }
        detalle = await api('GET', `/iniciativas/${iniciativa.id}`);
        tarea = tareaDe(
          detalle,
          'Hablar con bienestar universitario para pedir el turno extendido',
        );
        if (tarea.estado === 'en-curso') {
          const conEvidencia = await api(
            'POST',
            `/iniciativas/${iniciativa.id}/tareas/${tarea.id}/evidencias`,
            {
              token: P.laura.testigo,
              body: {
                requestId: rid(),
                offerId: tarea.ofertaId,
                revision: tarea.revision,
                contenido:
                  'Reunión con bienestar universitario el 12 de agosto: aceptan asignar un monitor ' +
                  'si el Instituto cubre el bono de la hora extendida. Falta que Vicerrectoría de ' +
                  'Bienestar confirme el valor.',
                visibilidad: 'restricted',
              },
            },
          );
          const tareaConEvidencia = tareaDe(
            conEvidencia,
            'Hablar con bienestar universitario para pedir el turno extendido',
          );
          const evidenciaId = tareaConEvidencia.evidencias.at(-1).id;
          console.log('    + Laura agregó evidencia');
          await api('POST', `/iniciativas/${iniciativa.id}/tareas/${tarea.id}/entregas`, {
            token: P.laura.testigo,
            body: {
              requestId: rid(),
              offerId: tareaConEvidencia.ofertaId,
              revision: tareaConEvidencia.revision,
              evidenciaIds: [evidenciaId],
              resumen:
                'Ya se habló con bienestar universitario y aceptan el turno extendido si el ' +
                'Instituto cubre el bono de la hora; falta que Vicerrectoría confirme el valor.',
            },
          });
          console.log('    + Laura entregó su tarea');
        }
      });

      await intentar('que Andrés acepte e inicie su tarea (sin entregar)', async () => {
        let detalle = await api('GET', `/iniciativas/${iniciativa.id}`);
        let tarea = tareaDe(
          detalle,
          'Armar el horario real de apertura para publicar en la cartelera',
        );
        if (tarea.estado === 'ofrecida') {
          await api('POST', `/iniciativas/${iniciativa.id}/tareas/${tarea.id}/respuestas`, {
            token: P.andres.testigo,
            body: {
              requestId: rid(),
              tipo: 'aceptar',
              offerId: tarea.ofertaId,
              revision: tarea.revision,
            },
          });
          console.log('    + Andrés aceptó su tarea');
        }
        detalle = await api('GET', `/iniciativas/${iniciativa.id}`);
        tarea = tareaDe(detalle, 'Armar el horario real de apertura para publicar en la cartelera');
        if (tarea.estado === 'aceptada') {
          await api('POST', `/iniciativas/${iniciativa.id}/tareas/${tarea.id}/iniciar`, {
            token: P.andres.testigo,
            body: { requestId: rid(), offerId: tarea.ofertaId, revision: tarea.revision },
          });
          console.log('    + Andrés inició su tarea');
        }
      });
    }

    await intentar('que Santiago rechace su oferta', async () => {
      const detalle = await api('GET', `/iniciativas/${iniciativa.id}`);
      const tarea = tareaDe(
        detalle,
        'Revisar si el aviso también debe salir en el boletín del Instituto',
      );
      if (tarea.estado !== 'ofrecida') return;
      await api('POST', `/iniciativas/${iniciativa.id}/tareas/${tarea.id}/respuestas`, {
        token: P.santiago.testigo,
        body: {
          requestId: rid(),
          tipo: 'rechazar',
          offerId: tarea.ofertaId,
          revision: tarea.revision,
          motivo: 'sin-disponibilidad',
        },
      });
      console.log('    + Santiago rechazó su oferta');
    });

    // Valentina no responde: su tarea se queda «ofrecida» a propósito.
  });

  // ── Resumen ──────────────────────────────────────────────────────────────────────────────────
  console.log('\n── Resumen ──────────────────────────────────────────────────────────────────');
  console.log(`API: ${API_BASE}`);
  console.log(
    !facilitadoraOk ? 'Facilitación: SIN configurar (ver aviso arriba)' : 'Facilitación: OK',
  );
  console.log(
    '\nCuentas sembradas (pedí el enlace de cualquiera en /entrar — no se reimprimen acá',
  );
  console.log('para no gastar de más el cupo de 5 enlaces por hora y por correo):');
  for (const { clave, correo } of ROSTER) {
    console.log(`  ${clave.padEnd(10)} ${correo}`);
  }
  console.log(
    '\nSi la decisión de plazo corto sigue "Open", correlo de nuevo pasada una hora para verla',
  );
  console.log('cerrada, con su resultado y con su iniciativa (todavía provisional).');
  console.log(
    'Para ver esa iniciativa con hitos y tareas hacen falta además 72 horas reales más, desde el',
  );
  console.log('cierre: es la ventana de impugnación, y este script no tiene forma de acortarla.\n');
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  if (process.env.DEBUG !== undefined) console.error(error.stack);
  process.exitCode = 1;
});
