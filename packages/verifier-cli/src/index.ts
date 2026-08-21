/**
 * `@koinonia/verificar` — el verificador independiente.
 *
 * ═══ Por qué existe ═══
 *
 * Si el único verificador es el nuestro, no probamos nada: es pedirle al acusado que redacte el
 * peritaje. La pantalla «Verificar integridad» de la web la sirve **el mismo servidor que se está
 * auditando**; un administrador que lo controla sirve un verificador que siempre dice verde, y
 * ninguna cantidad de criptografía dentro de ese código lo arregla, porque el atacante controla el
 * código.
 *
 * Este paquete mueve el problema —npm, la forja y el ordenador de quien lo ejecuta son terceros
 * nuevos— pero no lo elimina, y decirlo es parte del diseño. La mitigación real es procedimental:
 * que personas sin relación con la administración lo ejecuten en sus propios equipos, y que
 * `README-VERIFICACION.txt` permita reimplementarlo desde cero si un día no queda nada de esto.
 *
 * Por eso el paquete tiene tres propiedades que no son negociables:
 *
 *  1. **No habla con nuestro servidor.** Trabaja sobre un fichero autocontenido.
 *  2. **No importa código de `services/api`.** Los algoritmos del §6.2 y del §6.4 están
 *     reimplementados aquí; que las dos implementaciones coincidan es parte de la prueba.
 *  3. **Se lee en una tarde.** Es lo que permite auditarlo en vez de confiar en él.
 */

export {
  anchorProofPath,
  anchorReceiptPath,
  BITCOIN_HEADERS_FILE,
  CHECKPOINTS_FILE,
  consistencyProofPath,
  decodeText,
  EVENT_HASHES_FILE,
  EVENTS_FILE,
  EXPORT_FORMAT_VERSION,
  ExportFormatError,
  HEADS_FILE,
  MANIFEST_FILE,
  memorySource,
  ndjsonLines,
  parseBitcoinHeaders,
  parseCheckpoint,
  parseConsistencyProof,
  parseEventHashes,
  parseHeads,
  parseManifest,
  parseTrustRoster,
  README_FILE,
  sinSaltoFinal,
  TRUST_FILE,
  type ExportedCheckpoint,
  type ExportedConsistencyProof,
  type ExportedEvent,
  type ExportedEventHashes,
  type ExportedHead,
  type ExportManifest,
  type ExportSource,
  type ManifestFileEntry,
  type TrustRoster,
} from './formato.js';

export {
  CATALOGO,
  SALIDA,
  salidaPara,
  severidadDe,
  type CodigoHallazgo,
  type CodigoSalida,
  type DescripcionHallazgo,
  type Hallazgo,
  type Severidad,
} from './hallazgos.js';

export {
  hashDeCheckpoint,
  raizDeCabezas,
  verificarExport,
  type EstadoAnclaje,
  type OpcionesVerificacion,
  type Paso,
  type ResultadoVerificacion,
} from './verificar.js';

export { envolver, renderInforme, SALIDAS_EXPLICADAS, type OpcionesInforme } from './informe.js';

export {
  analizarArgumentos,
  AYUDA,
  ejecutar,
  VERSION,
  type Argumentos,
  type EntornoPrograma,
  type ResultadoPrograma,
} from './programa.js';

export { README_VERIFICACION } from './readme-verificacion.js';

export { directorySource, RutaInvalidaError } from './fuente-directorio.js';
