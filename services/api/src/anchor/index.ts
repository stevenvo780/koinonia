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
 * ═══ Cómo está enganchado ═══
 *
 *  · `tarea`         — la tarea periódica: corta un checkpoint, lo ancla sin `poll`, y cada hora
 *                      repasa los pendientes con `poll: true`. La arranca `server.ts`.
 *  · `configuracion` — calendarios, forjas, testigos y credenciales, desde variables de entorno.
 *                      Ningún secreto vive en el código; la clave DKIM entra por ruta a fichero.
 *  · `cabeceras`     — descarga y guarda las cabeceras de bloque de Bitcoin que cierran los sellos.
 *                      `ledger/export.ts` ya publicaba `anchors/bitcoin-headers.json` desde la
 *                      tabla; nadie la llenaba, y sin ese fichero el verificador independiente se
 *                      queda en `incompleto` para siempre.
 *
 * Lo que sigue necesitando una persona, y no es un olvido: **el commit firmado de la veeduría**.
 * `SignedGitProvider.submit()` no firma porque no puede —la clave no está aquí, y ése es justo el
 * punto—. Alguien de la veeduría firma en su equipo y empuja a las dos forjas; la tarea lo recoge
 * en el siguiente `poll`.
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
  alturasAncladas,
  alturasConocidas,
  cabecerasGuardadas,
  cosecharCabeceras,
  EXPLORADOR_POR_DEFECTO,
  exploradorDeBloques,
  type CosechaDeCabeceras,
  type FuenteDeCabeceras,
} from './cabeceras.js';

export {
  booleano,
  configuracionDeAnclajeDesdeEntorno,
  parsearFirmantes,
  parsearTestigos,
  type ConfiguracionDeAnclaje,
  type ConfiguracionDeCorreo,
  type ConfiguracionDeDkim,
  type ConfiguracionDeForja,
  type ConfiguracionDeGit,
  type ConfiguracionDeImap,
  type ConfiguracionDeSmtp,
} from './configuracion.js';

export {
  checkpointsPendientes,
  crearTareaDeAnclaje,
  DIARIO_A_STDERR,
  proveedoresDesde,
  requestIdDeLote,
  type DiarioDeAnclaje,
  type TareaDeAnclaje,
  type TareaDeAnclajeOptions,
} from './tarea.js';

export {
  extraerAcuse,
  imapAckCollector,
  instruccionesDeAcuse,
  OCTETO_DE_DOMINIO_OCTAL,
  smtpWitnessTransport,
  type CorreoDeAnclajeOptions,
  type RecogidaOptions,
} from './correo.js';
