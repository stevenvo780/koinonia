/**
 * `services/api/src/anchor` — **los adaptadores del anclaje**: lo único de esta parte que hace I/O.
 *
 * `packages/anchor` define los puertos y toda la lógica que se puede comprobar sin red —el quórum,
 * la verificación de sellos y firmas, el retroceso exponencial, la comparación entre forjas—. Aquí
 * viven los clientes que hablan con el mundo:
 *
 *  · `calendarios` — OpenTimestamps sobre HTTP, con reintentos y varios calendarios.
 *  · `forjas`      — Codeberg y GitHub, reconstruyendo el objeto commit y contrastando su OID.
 *  · `correo`      — SMTP con DKIM para enviar, IMAP para recoger acuses y rebotes.
 *
 * ═══ Lo que falta enganchar, y no se enganchó a propósito ═══
 *
 * Nada de esto está **conectado** todavía: no hay ruta HTTP que dispare un ciclo de anclaje ni
 * tarea periódica que lo repita. Falta:
 *
 *  1. Una tarea periódica que llame a `runAnchorCycle()` tras cada checkpoint y de nuevo cada hora
 *     con `poll: true`, hasta que el sello madure y aparezca el commit de la veeduría.
 *  2. Leer la configuración —calendarios, forjas, credenciales de correo, padrón de testigos— de
 *     variables de entorno, en `server.ts`.
 *  3. Publicar `bitcoin-headers.txt` en el export a partir de `saveBitcoinHeader()`, para que el
 *     verificador independiente pueda cerrar la última afirmación del sello sin pedirle nada a
 *     nadie.
 *
 * Los tres tocan ficheros de otros; están declarados aquí para que no se pierdan.
 */

export {
  AGENTE,
  esReintentable,
  getJson,
  HttpError,
  MAX_CUERPO_BYTES,
  nodeFetch,
  PLAZO_POR_DEFECTO_MS,
  sinDireccionesIp,
  type HttpOptions,
} from './http.js';

export {
  calendarioConReintentos,
  CALENDARIOS_PUBLICOS,
  calendariosDeProduccion,
  POOL_DE_PRUEBA,
  relojDelSistema,
  type CalendariosOptions,
} from './calendarios.js';

export {
  codebergForge,
  colocacionesDeFirma,
  ForgeReconstructionError,
  githubForge,
  leerOid,
  leerVerificacion,
  reconstruirCommitFirmado,
  type ForgeRepoOptions,
} from './forjas.js';

export {
  CABECERAS_FIRMADAS,
  canonicalizarCabecera,
  canonicalizarCuerpo,
  firmarDkim,
  hashDeCuerpo,
  type AlgoritmoDkim,
  type CabeceraDeCorreo,
  type CanonicalizacionCuerpo,
  type DkimOptions,
  type DkimSignature,
} from './dkim.js';

export {
  LineReader,
  nodeConnect,
  socketGuionizado,
  type Conectar,
  type DestinoDeRed,
  type DuplexLike,
  type GuionDeServidor,
  type SocketGuionizado,
} from './socket.js';

export {
  enviarPorSmtp,
  parsearRespuestaSmtp,
  rellenarPuntos,
  SmtpError,
  type EntregaSmtp,
  type MensajeSmtp,
  type ModoTls,
  type RespuestaSmtp,
  type SmtpOptions,
} from './smtp.js';

export {
  entrecomillar,
  ImapError,
  leerHastaEtiqueta,
  leerLineaImap,
  parsearFetch,
  parsearSearch,
  recogerMensajes,
  type ImapOptions,
  type LineaImap,
  type RespuestaImap,
} from './imap.js';

export {
  cabecera,
  cuerpoDecodificado,
  direccionesDe,
  ensamblar,
  parametro,
  parsearMensaje,
  partesMime,
  tipoDeContenido,
  todasLasPartes,
  type MensajeCorreo,
} from './mime.js';

export {
  mensajeOriginalDe,
  padronDesde,
  parsearRebotes,
  respondeA,
  type PadronDeTestigos,
} from './rebotes.js';

export {
  extraerAcuse,
  imapAckCollector,
  instruccionesDeAcuse,
  OCTETO_DE_DOMINIO_OCTAL,
  smtpWitnessTransport,
  type CorreoDeAnclajeOptions,
  type RecogidaOptions,
} from './correo.js';
