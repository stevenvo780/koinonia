/**
 * Órdenes del borrador y **el pliegue**.
 *
 * ═══ Por qué las reglas viven en el pliegue y no en las órdenes ═══
 *
 * Es el mismo argumento de la constitución (ADR-0051) y aquí importa igual: la orden es **una**
 * puerta; el pliegue es por donde pasa **todo** historial —el que escribe esta API, el que sale de
 * una restauración y el que alguien trae en un fichero—. Una regla que sólo estuviera en la orden se
 * esquivaría escribiendo el evento por otro camino, y el historial resultante se plegaría tan
 * tranquilo. `applyAssistant` revalida todo: la autoría, la forma de cada respuesta, el
 * consentimiento, la existencia de la sugerencia que alguien dice haber tomado y el hecho de que el
 * texto tomado estuviera de verdad en ella.
 *
 * Las órdenes, además, **se validan contra su propio pliegue antes de devolver el evento**: cada una
 * termina llamando a `applyAssistant` sobre el evento que acaba de sellar. Así no puede existir una
 * orden que emita algo que el pliegue rechazaría al releerlo, que es la forma más común de tener un
 * historial que no se puede volver a cargar.
 *
 * ═══ Las tres reglas de autoría, y por qué son tres ═══
 *
 *  1. **Abrir, responder, aplicar, consentir y cerrar los hace una persona**, y tiene que ser la
 *     misma que abrió el borrador. Un borrador es el texto de alguien.
 *  2. **`SugerenciaRecibida` la hace `'system'`**, y el pliegue lo exige. Si la oferta de la máquina
 *     quedara atada a una persona, el historial permitiría contar cuántas rechaza cada quien, que es
 *     una métrica de actividad individual (ADR-0040). Aquí ni siquiera hay un parámetro donde poner
 *     ese nombre: `registrarSugerencia` recibe `MetaDeSistema`, que no tiene campo `actor`.
 *  3. **No existe un evento de rechazo.** Que una sugerencia no se aplicara se sabe por ausencia. El
 *     agregado de lo no aplicado sirve para auditar a la máquina —`conteoDeSugerencias`—; no sirve
 *     para perfilar a quien la usó, porque no hay a quién atribuirlo.
 *
 * ═══ Por qué el pliegue coteja el texto aplicado contra el sugerido ═══
 *
 * Sin ese cotejo, «esto lo sugirió la máquina» sería una etiqueta que cualquiera se pone y la
 * procedencia no valdría para lo único que sirve: distinguir, años después, lo que escribió una
 * persona de lo que le propuso un modelo. Así que `SugerenciaAplicada` sólo entra si el texto está
 * **literalmente** entre los que aquella sugerencia ofreció. Quien tome una sugerencia y la retoque
 * antes de guardarla no está aplicándola: está escribiendo, y eso es `RespuestaEscrita`, con su
 * nombre encima. La distinción no es burocrática — es la diferencia entre «lo dijo la máquina» y «lo
 * dije yo después de leer a la máquina», y sólo la segunda es autoría.
 */

import { PreconditionError } from '../errors.js';
import { type EventId, type Instant, type MemberId, ZERO_HASH } from '../ids.js';
import { assertLedgerText } from '../workspace/text.js';
import { appendChained, verifyChain } from '../workspace/chain.js';
import { type NumeroPregunta, esNumeroDePregunta, pregunta } from './preguntas.js';
import { type DisponibilidadIA, modoDelAsistente, motivoEstructural } from './cierre.js';
import { siguienteEstado } from './state-machine.js';
import {
  type AssistantEvent,
  type AssistantLog,
  type AssistantPayload,
  type AssistantState,
  type BorradorId,
  type DestinoIA,
  type OperacionIA,
  type PeticionIA,
  type Respuesta,
  type SugerenciaCualquiera,
  type SugerenciaId,
  type SugerenciaRegistrada,
  type VersionDeRespuesta,
  assertPeticionSinIdentidad,
  assertSugerenciaSinPoder,
  consentimientoCubre,
  esOperacionIA,
  esOperacionProhibida,
  estaRespondida,
  faltanObligatorias,
  formaEncaja,
  initialAssistantState,
  MAX_LINEAS,
  MAX_TEXTO_SUGERIDO,
  respuestaDe,
  sugerenciaRegistrada,
  textosDe,
  textosDeRespuesta,
} from './types.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Metadatos de las órdenes
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Lo que aporta quien ejecuta una orden **de persona**. El `actor` es obligatorio y es alguien. */
export interface AssistantCommandMeta {
  readonly eventId: EventId;
  readonly occurredAt: Instant;
  readonly actor: MemberId;
}

/**
 * Lo que aporta el sistema al registrar una sugerencia. **No tiene `actor`.**
 *
 * No es un olvido: es la regla 2 de la cabecera puesta en el tipo. Sin campo donde escribir un
 * nombre, no hay forma de atribuir a una persona el hecho de que una máquina le ofreciera algo.
 */
export interface MetaDeSistema {
  readonly eventId: EventId;
  readonly occurredAt: Instant;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Auxiliares del pliegue
// ═════════════════════════════════════════════════════════════════════════════════════════════

function exigeAutor(estado: AssistantState): MemberId {
  const autor = estado.autor;
  if (autor === undefined) {
    throw new PreconditionError(
      'DRAFT_NOT_OPEN',
      'no hay borrador: el primer evento del historial tiene que ser el que lo abre',
    );
  }
  return autor;
}

function assertEsElAutor(estado: AssistantState, evento: AssistantEvent): void {
  const autor = exigeAutor(estado);
  if (evento.actor !== autor) {
    throw new PreconditionError(
      'NOT_THE_AUTHOR',
      'este borrador es de otra persona: nadie escribe en el borrador de nadie. Si el acto lo hizo ' +
        'el sistema, tampoco: sólo `SugerenciaRecibida` es del sistema',
    );
  }
}

function assertNumero(valor: number): NumeroPregunta {
  if (!esNumeroDePregunta(valor)) {
    throw new PreconditionError(
      'UNKNOWN_QUESTION',
      `no existe la pregunta ${String(valor)}: el formulario tiene 27 y no se amplía por evento`,
    );
  }
  return valor;
}

function assertTexto(texto: string, campo: string): void {
  assertLedgerText(texto, { field: campo, min: 1, max: MAX_TEXTO_SUGERIDO });
}

/** Cuántas líneas con contenido tiene la respuesta vigente de una pregunta en lista. */
function lineasVigentes(estado: AssistantState, numero: NumeroPregunta): number {
  const version = respuestaDe(estado, numero);
  if (version === undefined) return 0;
  return textosDeRespuesta(version.respuesta).filter((l) => l.trim() !== '').length;
}

/**
 * Comprueba la forma de una respuesta contra su pregunta y contra el estado.
 *
 * La 7 es el único caso que necesita mirar el estado: el documento la encabeza con «(por cada
 * causa)», así que tiene tantas casillas como causas haya escrito quien responde, ni una más. Sin
 * causas escritas no hay nada que enumerar y el evento se rechaza en vez de guardar una lista suelta
 * que mañana no se sabría a qué correspondía.
 */
function assertRespuestaValida(
  estado: AssistantState,
  numero: NumeroPregunta,
  respuesta: Respuesta,
): void {
  const q = pregunta(numero);
  if (!formaEncaja(q, respuesta)) {
    throw new PreconditionError(
      'ANSWER_SHAPE_MISMATCH',
      `la pregunta ${String(numero)} se responde en forma "${q.forma}" y llegó ` +
        `"${respuesta.forma}"`,
    );
  }
  if (respuesta.forma === 'todavia_no_se') return;

  if (respuesta.forma === 'frase') {
    assertTexto(respuesta.texto, `respuesta a la pregunta ${String(numero)}`);
    return;
  }

  const lineas = textosDeRespuesta(respuesta);
  if (lineas.length === 0) {
    throw new PreconditionError(
      'EMPTY_ANSWER',
      `la pregunta ${String(numero)} se responde en lista y llegó una lista vacía: para no ` +
        'responder está «todavía no sé», que además deja el hueco anotado',
    );
  }
  if (lineas.length > MAX_LINEAS) {
    throw new PreconditionError(
      'TOO_MANY_LINES',
      `el máximo son ${String(MAX_LINEAS)} líneas y llegaron ${String(lineas.length)}`,
    );
  }
  lineas.forEach((linea, i) => {
    assertTexto(linea, `línea ${String(i + 1)} de la pregunta ${String(numero)}`);
  });

  if (respuesta.forma === 'por_linea') {
    const origen = q.porCadaLineaDe;
    if (origen === undefined) {
      throw new PreconditionError(
        'NOTHING_TO_ENUMERATE',
        `la pregunta ${String(numero)} no enumera las líneas de ninguna otra`,
      );
    }
    const esperadas = lineasVigentes(estado, origen);
    if (esperadas === 0) {
      throw new PreconditionError(
        'NOTHING_TO_ENUMERATE',
        `la pregunta ${String(numero)} va por cada línea de la ${String(origen)}, y la ` +
          `${String(origen)} todavía no tiene ninguna`,
      );
    }
    if (lineas.length !== esperadas) {
      throw new PreconditionError(
        'LINE_COUNT_MISMATCH',
        `la ${String(origen)} tiene ${String(esperadas)} líneas y llegaron ${String(lineas.length)}`,
      );
    }
  }
}

function assertDestinoBienFormado(destino: DestinoIA): void {
  assertTexto(destino.aDondeVa, 'a dónde va el texto');
  assertTexto(destino.queSeManda, 'qué se manda');
  assertTexto(destino.queNoSeManda, 'qué no se manda');
}

function assertOperacion(nombre: string): OperacionIA {
  if (esOperacionProhibida(nombre)) {
    throw new PreconditionError(
      'FORBIDDEN_AI_OPERATION',
      `«${nombre}» es una de las operaciones que este puerto nunca expone: puntuar propuestas, ` +
        'moderar, evaluar impacto y fusionar borradores son actos de gobierno, no de apoyo. Ver ' +
        '`OPERACIONES_PROHIBIDAS` y el motivo de cada una',
    );
  }
  if (!esOperacionIA(nombre)) {
    throw new PreconditionError(
      'UNKNOWN_AI_OPERATION',
      `«${nombre}» no es ninguna de las siete operaciones del puerto`,
    );
  }
  return nombre;
}

function versionNueva(
  evento: AssistantEvent,
  numero: NumeroPregunta,
  respuesta: Respuesta,
  origen: 'mano' | 'sugerencia',
  sugerencia: SugerenciaId | undefined,
): VersionDeRespuesta {
  return {
    pregunta: numero,
    respuesta,
    origen,
    sugerenciaId: sugerencia,
    escritaEn: evento.occurredAt,
    seq: evento.seq,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El pliegue
// ═════════════════════════════════════════════════════════════════════════════════════════════

function aplicarAbierto(estado: AssistantState, evento: AssistantEvent): AssistantState {
  if (evento.actor === 'system') {
    throw new PreconditionError(
      'SYSTEM_CANNOT_OPEN',
      'un borrador lo abre una persona: es su texto y su autoría',
    );
  }
  return {
    ...estado,
    existe: true,
    autor: evento.actor,
    estado: 'redactando',
  };
}

function aplicarRespuesta(
  estado: AssistantState,
  evento: AssistantEvent,
  payload: Extract<AssistantPayload, { type: 'RespuestaEscrita' }>,
): AssistantState {
  assertEsElAutor(estado, evento);
  const numero = assertNumero(payload.pregunta);
  assertRespuestaValida(estado, numero, payload.respuesta);
  return {
    ...estado,
    historial: [
      ...estado.historial,
      versionNueva(evento, numero, payload.respuesta, 'mano', undefined),
    ],
  };
}

function aplicarSugerenciaRecibida(
  estado: AssistantState,
  evento: AssistantEvent,
  payload: Extract<AssistantPayload, { type: 'SugerenciaRecibida' }>,
): AssistantState {
  if (evento.actor !== 'system') {
    throw new PreconditionError(
      'SUGGESTION_MUST_BE_SYSTEM',
      'la oferta de la máquina no se atribuye a una persona: atarla a un nombre convertiría el ' +
        'historial en un contador de cuántas sugerencias rechaza cada quien, que es exactamente lo ' +
        'que ADR-0040 prohíbe',
    );
  }
  exigeAutor(estado);
  const s = payload.sugerencia;
  if (sugerenciaRegistrada(estado, s.sugerenciaId) !== undefined) {
    throw new PreconditionError(
      'DUPLICATE_SUGGESTION',
      'ya hay una sugerencia con ese identificador en este borrador',
    );
  }
  assertOperacion(s.operacion);
  if (s.pregunta !== undefined) assertNumero(s.pregunta);
  assertDestinoBienFormado(s.destino);
  if (!consentimientoCubre(estado, s.destino)) {
    throw new PreconditionError(
      'NO_CONSENT_FOR_DESTINATION',
      'no hay consentimiento vigente para ese destino: antes de mandar el texto de alguien a un ' +
        'tercero hay que pedírselo, diciendo a dónde va y qué se manda. Y el consentimiento vale ' +
        'para el destino que se describió, no para el que venga después',
    );
  }
  if (s.textos.length === 0) {
    throw new PreconditionError(
      'EMPTY_SUGGESTION',
      'una sugerencia sin texto no es una sugerencia; si el modelo no propuso nada, no hay nada ' +
        'que registrar',
    );
  }
  s.textos.forEach((texto, i) => {
    if (typeof texto !== 'string') {
      throw new PreconditionError(
        'SUGGESTION_NOT_TEXT',
        `lo que la máquina propuso en la posición ${String(i)} no es texto. Una sugerencia ` +
          'transporta palabras: un número sería un peso o una nota, y un booleano un veredicto',
      );
    }
    assertTexto(texto, `texto sugerido ${String(i + 1)}`);
  });
  return { ...estado, sugerencias: [...estado.sugerencias, s] };
}

function aplicarSugerenciaAplicada(
  estado: AssistantState,
  evento: AssistantEvent,
  payload: Extract<AssistantPayload, { type: 'SugerenciaAplicada' }>,
): AssistantState {
  assertEsElAutor(estado, evento);
  const s = sugerenciaRegistrada(estado, payload.sugerenciaId);
  if (s === undefined) {
    throw new PreconditionError(
      'UNKNOWN_SUGGESTION',
      'no se puede aceptar una sugerencia que nadie recibió: sin el evento que la registró, la ' +
        'procedencia diría que lo propuso una máquina sin que conste qué propuso',
    );
  }
  if (estado.aplicadas.includes(payload.sugerenciaId)) {
    throw new PreconditionError(
      'SUGGESTION_ALREADY_APPLIED',
      'esa sugerencia ya se aplicó una vez; volver a escribir lo mismo es escribir, no aplicar',
    );
  }
  const numero = assertNumero(payload.pregunta);
  if (s.pregunta !== undefined && s.pregunta !== numero) {
    throw new PreconditionError(
      'SUGGESTION_SCOPE_MISMATCH',
      `esa sugerencia se pidió para la pregunta ${String(s.pregunta)} y se está aplicando a la ` +
        String(numero),
    );
  }
  if (payload.respuesta.forma === 'todavia_no_se') {
    throw new PreconditionError(
      'CANNOT_SUGGEST_IGNORANCE',
      '«todavía no sé» lo dice una persona sobre lo que sabe: no es algo que una máquina proponga ' +
        'y alguien acepte',
    );
  }
  assertRespuestaValida(estado, numero, payload.respuesta);
  const ofrecidos = new Set(s.textos);
  for (const texto of textosDeRespuesta(payload.respuesta)) {
    if (!ofrecidos.has(texto)) {
      throw new PreconditionError(
        'TEXT_NOT_IN_SUGGESTION',
        'ese texto no estaba en la sugerencia. Tomar una sugerencia y retocarla no es aplicarla: ' +
          'es escribir, y se guarda como lo que es, con la autoría de quien escribió',
      );
    }
  }
  return {
    ...estado,
    historial: [
      ...estado.historial,
      versionNueva(evento, numero, payload.respuesta, 'sugerencia', payload.sugerenciaId),
    ],
    aplicadas: [...estado.aplicadas, payload.sugerenciaId],
  };
}

function aplicarConsentimiento(
  estado: AssistantState,
  evento: AssistantEvent,
  payload: Extract<AssistantPayload, { type: 'ConsentimientoDecidido' }>,
): AssistantState {
  assertEsElAutor(estado, evento);
  assertDestinoBienFormado(payload.destino);
  return {
    ...estado,
    consentimiento: {
      concedido: payload.concedido,
      destino: payload.destino,
      decididoEn: evento.occurredAt,
      seq: evento.seq,
    },
  };
}

function aplicarCierre(estado: AssistantState, evento: AssistantEvent): AssistantState {
  assertEsElAutor(estado, evento);
  const faltan = faltanObligatorias(estado);
  if (faltan.length > 0) {
    throw new PreconditionError(
      'MANDATORY_ANSWERS_MISSING',
      `falta por responder: ${faltan.map((n) => String(n)).join(', ')}. De las 27 preguntas sólo ` +
        'la 1 y la 11 hacen falta para cerrar; las otras 25 pueden quedar en blanco y quedan ' +
        'anotadas como huecos',
    );
  }
  return { ...estado, estado: 'cerrado', cerradoEn: evento.occurredAt };
}

/**
 * El pliegue. Un evento sobre un estado, con todas las reglas revalidadas.
 *
 * Comprueba, **para todos los eventos y sin excepción**: que la secuencia es densa, que el evento es
 * de este borrador, y que la transición existe en la tabla. Después, lo propio de cada tipo.
 */
export function applyAssistant(estado: AssistantState, evento: AssistantEvent): AssistantState {
  if (evento.seq !== estado.lastSeq + 1) {
    throw new PreconditionError(
      'NON_DENSE_SEQ',
      `se esperaba el evento ${String(estado.lastSeq + 1)} y llegó el ${String(evento.seq)}`,
    );
  }
  if (evento.aggregateId !== estado.borradorId) {
    throw new PreconditionError(
      'WRONG_AGGREGATE',
      'ese evento es de otro borrador: un historial que mezcla agregados no es un historial',
    );
  }
  const proximo = siguienteEstado(estado.estado, evento.payload.type);

  let siguiente: AssistantState;
  switch (evento.payload.type) {
    case 'BorradorAbierto':
      siguiente = aplicarAbierto(estado, evento);
      break;
    case 'RespuestaEscrita':
      siguiente = aplicarRespuesta(estado, evento, evento.payload);
      break;
    case 'SugerenciaRecibida':
      siguiente = aplicarSugerenciaRecibida(estado, evento, evento.payload);
      break;
    case 'SugerenciaAplicada':
      siguiente = aplicarSugerenciaAplicada(estado, evento, evento.payload);
      break;
    case 'ConsentimientoDecidido':
      siguiente = aplicarConsentimiento(estado, evento, evento.payload);
      break;
    case 'BorradorCerrado':
      siguiente = aplicarCierre(estado, evento);
      break;
  }

  return { ...siguiente, estado: proximo, lastSeq: evento.seq };
}

/** Pliega el historial entero. No verifica la cadena: para eso está `verifyAssistantLog`. */
export function replayAssistant(id: BorradorId, log: AssistantLog): AssistantState {
  let estado = initialAssistantState(id);
  for (const evento of log) estado = applyAssistant(estado, evento);
  return estado;
}

/**
 * Verifica la cadena y pliega. Es lo que hay que llamar sobre un historial que viene de fuera.
 *
 * Primero la cadena —borrado, inserción y reordenamiento— y sólo después las reglas: un historial con
 * la cadena rota no merece que se le miren las reglas, y decir «falta la pregunta 11» de algo que
 * está manipulado sería contar la segunda historia y callar la primera.
 */
export async function verifyAssistantLog(
  id: BorradorId,
  log: AssistantLog,
): Promise<AssistantState> {
  await verifyChain(log);
  return replayAssistant(id, log);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Órdenes
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Sella un evento, **después de comprobar que el pliegue lo aceptará**.
 *
 * El orden importa y es al revés de lo que parece natural. Primero se pliega un evento provisional
 * —mismo `seq`, mismo actor, mismo contenido, con los hashes todavía sin calcular, que el pliegue no
 * mira—, y sólo si pasa se encadena de verdad. Dos razones:
 *
 *  1. **El error que sale es el del dominio.** Si se sellara primero, un texto sin normalizar lo
 *    rechazaría la canonicalización con «no está en NFC» antes de que nadie pudiera decir «esa
 *    respuesta no vale». Las dos cosas son ciertas; sólo una le sirve a quien está escribiendo.
 *  2. **Ninguna orden emite algo que el pliegue rechazaría al releerlo.** Un historial así no se
 *    puede volver a cargar, y eso se descubriría el día de la restauración.
 *
 * El evento provisional se descarta siempre: nunca sale de esta función.
 */
async function sellar(
  id: BorradorId,
  log: AssistantLog,
  payload: AssistantPayload,
  actor: MemberId | 'system',
  meta: { readonly eventId: EventId; readonly occurredAt: Instant },
): Promise<AssistantEvent> {
  const estado = replayAssistant(id, log);
  applyAssistant(estado, {
    eventId: meta.eventId,
    aggregateId: id,
    seq: log.length + 1,
    occurredAt: meta.occurredAt,
    actor,
    payload,
    prevHash: log.at(-1)?.hash ?? ZERO_HASH,
    hash: ZERO_HASH,
  });
  return appendChained<AssistantPayload>(log, {
    eventId: meta.eventId,
    aggregateId: id,
    occurredAt: meta.occurredAt,
    actor,
    payload,
  });
}

/** Abre un borrador. Lo abre una persona, y esa persona es la única que escribe en él. */
export async function abrirBorrador(
  id: BorradorId,
  log: AssistantLog,
  meta: AssistantCommandMeta,
): Promise<AssistantEvent> {
  return sellar(id, log, { type: 'BorradorAbierto' }, meta.actor, meta);
}

export interface EscribirRespuestaInput {
  readonly pregunta: NumeroPregunta;
  readonly respuesta: Respuesta;
}

/**
 * Escribe —o reescribe— una respuesta a mano.
 *
 * Nada se pisa: cada escritura es una versión más en el historial, y la última manda. Que una
 * respuesta escrita a mano después de aplicar una sugerencia prevalezca sobre ella no es una regla
 * aparte: es lo que pasa cuando el historial se apila y se lee al derecho.
 */
export async function escribirRespuesta(
  id: BorradorId,
  log: AssistantLog,
  entrada: EscribirRespuestaInput,
  meta: AssistantCommandMeta,
): Promise<AssistantEvent> {
  return sellar(
    id,
    log,
    { type: 'RespuestaEscrita', pregunta: entrada.pregunta, respuesta: entrada.respuesta },
    meta.actor,
    meta,
  );
}

export interface RegistrarSugerenciaInput {
  readonly sugerenciaId: SugerenciaId;
  /** Lo que devolvió el puerto, tal cual. Toda `Sugerencia<C>` encaja en `SugerenciaCualquiera`. */
  readonly sugerencia: SugerenciaCualquiera;
  /** A qué pregunta apuntaba lo que se pidió; `undefined` si miraba el borrador entero. */
  readonly pregunta: NumeroPregunta | undefined;
  readonly destino: DestinoIA;
}

/**
 * Registra que una máquina propuso algo. **`actor` es `'system'` y no se puede cambiar.**
 *
 * Aquí es donde la salida del puerto entra al sistema, así que aquí corre el guardián de tiempo de
 * ejecución: `assertSugerenciaSinPoder` recorre el contenido y revienta ante cualquier cosa que no
 * sea texto o número de pregunta. Después se aplana a la lista de textos que va al historial, que es
 * una forma **estructuralmente incapaz** de transportar un peso o un veredicto: sólo caben cadenas, y
 * el pliegue comprueba que lo sean.
 */
export async function registrarSugerencia(
  id: BorradorId,
  log: AssistantLog,
  entrada: RegistrarSugerenciaInput,
  meta: MetaDeSistema,
): Promise<AssistantEvent> {
  // La comparación se hace sobre un `string` a propósito. En el tipo, `clase` sólo puede valer
  // `'sugerencia'` y el compilador diría que esta rama sobra; en tiempo de ejecución llega lo que
  // devuelva un adaptador, que puede haber sido escrito en JavaScript sin tipos o haberse saltado el
  // compilador con un `as`. Ensanchar el tipo aquí es lo que mantiene viva la comprobación.
  const clase: string = entrada.sugerencia.clase;
  if (clase !== 'sugerencia') {
    throw new PreconditionError(
      'NOT_A_SUGGESTION',
      'lo que devolvió el puerto no se declara como sugerencia; no hay otra clase de respuesta ' +
        'admisible de un modelo',
    );
  }
  assertOperacion(entrada.sugerencia.operacion);
  assertSugerenciaSinPoder(entrada.sugerencia.contenido);
  const textos = textosDe(entrada.sugerencia.contenido);
  const registrada: SugerenciaRegistrada = {
    sugerenciaId: entrada.sugerenciaId,
    operacion: entrada.sugerencia.operacion,
    pregunta: entrada.pregunta,
    textos,
    destino: entrada.destino,
  };
  return sellar(id, log, { type: 'SugerenciaRecibida', sugerencia: registrada }, 'system', meta);
}

export interface AplicarSugerenciaInput {
  readonly sugerenciaId: SugerenciaId;
  readonly pregunta: NumeroPregunta;
  readonly respuesta: Respuesta;
}

/**
 * Una persona toma una sugerencia. **Es el único camino de una sugerencia a una respuesta.**
 *
 * Ninguna cantidad de sugerencias recibidas cambia por sí sola una respuesta: hasta que alguien
 * ejecuta esta orden, lo que propuso la máquina está en el historial y no está en el formulario.
 */
export async function aplicarSugerencia(
  id: BorradorId,
  log: AssistantLog,
  entrada: AplicarSugerenciaInput,
  meta: AssistantCommandMeta,
): Promise<AssistantEvent> {
  return sellar(
    id,
    log,
    {
      type: 'SugerenciaAplicada',
      sugerenciaId: entrada.sugerenciaId,
      pregunta: entrada.pregunta,
      respuesta: entrada.respuesta,
    },
    meta.actor,
    meta,
  );
}

export interface DecidirConsentimientoInput {
  readonly concedido: boolean;
  readonly destino: DestinoIA;
}

/**
 * La persona dice si su texto puede salir hacia ese destino, y hacia cuál.
 *
 * Si dice que no, el modo pasa a estructural sin penalización y el sistema no vuelve a preguntar
 * (`sePuedePedirConsentimiento`). Cambiar de idea sigue siendo posible: es esta misma orden, ejecutada
 * por ella.
 */
export async function decidirConsentimiento(
  id: BorradorId,
  log: AssistantLog,
  entrada: DecidirConsentimientoInput,
  meta: AssistantCommandMeta,
): Promise<AssistantEvent> {
  return sellar(
    id,
    log,
    { type: 'ConsentimientoDecidido', concedido: entrada.concedido, destino: entrada.destino },
    meta.actor,
    meta,
  );
}

/** Cierra el borrador. Sólo se puede si la 1 y la 11 están respondidas. */
export async function cerrarBorrador(
  id: BorradorId,
  log: AssistantLog,
  meta: AssistantCommandMeta,
): Promise<AssistantEvent> {
  return sellar(id, log, { type: 'BorradorCerrado' }, meta.actor, meta);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La única forma legítima de construir una petición para el puerto
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ConstruirPeticionInput {
  readonly operacion: OperacionIA;
  readonly fragmento: string;
  readonly conQueComparar?: readonly string[] | undefined;
}

/**
 * Arma la petición que sale hacia el tercero, o lanza.
 *
 * Dos guardianes y hacen falta los dos:
 *
 *  1. **Sin consentimiento no se invoca el puerto.** Se comprueba contra el destino descrito, no
 *     contra «hay consentimiento en general».
 *  2. **Sólo viaja el fragmento.** `assertPeticionSinIdentidad` busca en el texto cualquier cosa con
 *     forma de identificador opaco y, además, los identificadores concretos de este borrador. Ni el
 *     `borradorId`, ni el autor, ni las respuestas anteriores entran en la petición: no hay campo
 *     donde ponerlos.
 *
 * Que esto viva en el dominio y no en el adaptador es deliberado: el adaptador es donde acaba
 * habiendo prisa.
 */
export function construirPeticion(
  estado: AssistantState,
  disponibilidad: DisponibilidadIA,
  entrada: ConstruirPeticionInput,
): PeticionIA {
  if (modoDelAsistente(estado, disponibilidad) !== 'generativo') {
    throw new PreconditionError(
      'AI_NOT_AVAILABLE',
      'no se puede invocar el puerto ahora: ' +
        `${motivoEstructural(estado, disponibilidad) ?? 'sin_proveedor'}. El asistente sigue ` +
        'funcionando en modo estructural, que no necesita ningún proveedor',
    );
  }
  assertOperacion(entrada.operacion);
  assertTexto(entrada.fragmento, 'fragmento que sale hacia el tercero');
  const peticion: PeticionIA = {
    operacion: entrada.operacion,
    fragmento: entrada.fragmento,
    conQueComparar: entrada.conQueComparar ?? [],
  };
  assertPeticionSinIdentidad(peticion, [
    estado.borradorId,
    ...(estado.autor === undefined ? [] : [estado.autor]),
    ...estado.sugerencias.map((s) => s.sugerenciaId),
  ]);
  return peticion;
}

/**
 * Cuántas respuestas hay escritas, para el aviso de la interfaz.
 *
 * Es un conteo del borrador, no de la persona: cuenta preguntas respondidas, y ninguna proyección de
 * este módulo lleva un `MemberId` fuera del propio autor del borrador.
 */
export function cuantasRespondidas(estado: AssistantState): number {
  let total = 0;
  for (const version of estado.historial) {
    const vigente = respuestaDe(estado, version.pregunta);
    if (vigente?.seq === version.seq && estaRespondida(version.respuesta)) total += 1;
  }
  return total;
}
