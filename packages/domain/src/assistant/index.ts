/**
 * Agregado **asistente de acción sistémica**.
 *
 * Convierte una idea informal en un plan accionable sin que quien la escribe tenga que saber gestión
 * de proyectos: 27 preguntas en castellano llano, sólo dos obligatorias, «todavía no sé» siempre
 * válido, y al final una sola frase con lo que acaba de decir.
 *
 *  - `preguntas.ts`     — las 27 preguntas literales de §3.1, con su forma y su tramo.
 *  - `types.ts`         — el puerto `AIAssistantPort`, la barrera de tipos que le impide decidir,
 *                         los eventos, el estado y las proyecciones (incluida la tasa **colectiva**
 *                         de aceptación).
 *  - `state-machine.ts` — tres estados y una tabla; `cerrado` es absorbente.
 *  - `cierre.ts`        — la frase de cierre como **función pura** y el modo sin IA.
 *  - `commands.ts`      — las órdenes y el pliegue, que es donde se aplican las reglas de verdad.
 *
 * ═══ Principio 6, y dónde vive cada mitad ═══
 *
 * «La IA asesora, estructura y facilita; nunca gobierna ni vota.» Sin excepciones y sin banderas.
 *
 *  1. **No puede decidir** — `Inocuo` (`types.ts`) hace que el contenido de una sugerencia sea
 *     `never` en cuanto pueda transportar un booleano, un número o un identificador. Un campo `never`
 *     no se construye: la implementación no compila.
 *  2. **No puede mutar** — no hay orden que convierta una sugerencia en otra cosa que la respuesta a
 *     una pregunta, y sólo si una persona ejecuta `aplicarSugerencia`. El pliegue coteja además que
 *     el texto aplicado estuviera literalmente en la sugerencia.
 *  3. **No puede nombrar** — el puerto no conoce ningún identificador del sistema, ni al recibir
 *     (`PeticionIA` lleva un fragmento y nada más) ni al devolver (`Sugerencia` no tiene campo donde
 *     poner un `MemberId`).
 *  4. **No puede existir sin permiso** — `construirPeticion` es el único camino a una llamada, y
 *     exige consentimiento para **ese** destino concreto.
 *  5. **No puede volverse imprescindible** — sin proveedor configurado, `cierre.ts` da el formulario
 *     entero, los huecos y la frase, y no lanza.
 *  6. **No puede gobernar por acumulación** — `tasaDeAceptacionColectiva` mira si la comunidad está
 *     aceptando casi todo lo que propone la máquina. Sobre el colectivo, jamás por persona
 *     (ADR-0040).
 *
 * ADR-0052.
 */

export {
  abrirBorrador,
  aplicarSugerencia,
  type AplicarSugerenciaInput,
  applyAssistant,
  type AssistantCommandMeta,
  cerrarBorrador,
  construirPeticion,
  type ConstruirPeticionInput,
  cuantasRespondidas,
  decidirConsentimiento,
  type DecidirConsentimientoInput,
  escribirRespuesta,
  type EscribirRespuestaInput,
  type MetaDeSistema,
  registrarSugerencia,
  type RegistrarSugerenciaInput,
  replayAssistant,
  verifyAssistantLog,
} from './commands.js';

export {
  type AyudaEstructural,
  ayudaEstructural,
  type DisponibilidadIA,
  type FraseDeCierre,
  fraseDeCierre,
  HUECO,
  type ModoAsistente,
  modoDelAsistente,
  type MotivoEstructural,
  motivoEstructural,
  MOTIVOS_ESTRUCTURALES,
  PREGUNTA_DE_CIERRE,
  PREGUNTAS_DE_LA_FRASE,
  SIN_IA,
  siguientePregunta,
  TEXTO_DEL_MOTIVO,
} from './cierre.js';

export {
  CUANTAS_PREGUNTAS,
  esNumeroDePregunta,
  esObligatoria,
  type FormaDeRespuesta,
  FORMAS,
  GRUPOS,
  type GrupoPregunta,
  type NumeroPregunta,
  type Pregunta,
  pregunta,
  PREGUNTAS,
  PREGUNTAS_OBLIGATORIAS,
  preguntasDe,
  TITULO_DE_GRUPO,
} from './preguntas.js';

export {
  ESTADOS_BORRADOR,
  ESTADOS_TERMINALES,
  esTerminal,
  esTransicionLegal,
  eventosLegalesDesde,
  siguienteEstado,
  type Transicion,
  TRANSICIONES,
} from './state-machine.js';

export {
  type AIAssistantPort,
  type AlternativasSugeridas,
  ASSISTANT_EVENT_TYPES,
  type AssistantEvent,
  type AssistantEventType,
  type AssistantLog,
  type AssistantPayload,
  type AssistantState,
  assertPeticionSinIdentidad,
  assertSugerenciaSinPoder,
  type BorradorId,
  CAMPO_NUMERICO_PERMITIDO,
  borradorId,
  conteoDeSugerencias,
  type ConteoDeSugerencias,
  consentimientoCubre,
  type ContradiccionesSugeridas,
  type DecisionDeConsentimiento,
  type Desajuste,
  desajustes,
  type DestinoIA,
  type EsInocuo,
  esOperacionIA,
  esOperacionProhibida,
  type EstadoBorrador,
  estaRespondida,
  type EstructuraSugerida,
  type ExplicacionSugerida,
  faltanObligatorias,
  formaEncaja,
  type FormaDeRespuestaDada,
  FORMAS_DE_RESPUESTA,
  fueAplicada,
  FugaDeIdentidad,
  historialDeRespuesta,
  type Hueco,
  huecos,
  initialAssistantState,
  type Inocuo,
  MAX_LINEAS,
  MAX_TEXTO_SUGERIDO,
  METODO_DE_OPERACION,
  MINIMO_DE_BORRADORES,
  mismoDestino,
  type MotivoDeHueco,
  type OperacionIA,
  OPERACIONES,
  OPERACIONES_PROHIBIDAS,
  type OperacionProhibida,
  type OrigenDeRespuesta,
  ORIGENES,
  type ParecidoSugerido,
  type ParecidosSugeridos,
  type PeticionIA,
  procedencia,
  type ProcedenciaDeRespuesta,
  type Prohibicion,
  puedeCerrarse,
  type PuertoDeIA,
  type ResumenSugerido,
  type Respuesta,
  respuestaDe,
  sePuedePedirConsentimiento,
  type Sugerencia,
  type SugerenciaCualquiera,
  SugerenciaConPoder,
  type SugerenciaId,
  sugerenciaId,
  type SugerenciaRegistrada,
  sugerenciaRegistrada,
  type TareasSugeridas,
  tasaDeAceptacionColectiva,
  type TasaColectiva,
  type TensionSugerida,
  type TextoSugerido,
  textoSugerido,
  textosDe,
  textosDeRespuesta,
  TITULO_DE_OPERACION,
  type TramoSugerido,
  UMBRAL_DE_FRICCION,
  type VersionDeRespuesta,
} from './types.js';
