/**
 * `AlmacenDeObjetos`: el puerto de almacenamiento binario, con clave, contenido y metadatos.
 *
 * ═══ Para qué existe ═══
 *
 * El pliego pide "almacenamiento compatible con S3" y hoy no hay ni adjuntos ni evidencia binaria en
 * el sistema — sólo texto restringido cifrado (`http/private-material-store.ts`, otro puerto,
 * distinto problema: ese guarda opacamente ligado a la bóveda de una persona; éste guarda objetos
 * con nombre y tipo, como un adjunto de tarea o un comprobante escaneado). Este fichero es la
 * interfaz sola. `disco.ts` es la única implementación real, hoy. `s3.ts` deja el tipo de
 * configuración listo y el error explícito de por qué no hay más.
 *
 * ═══ Por qué la clave se valida acá y no en cada implementación ═══
 *
 * Una `clave` que contenga `..`, empiece por `/` o traiga un byte nulo es un vector de escape del
 * directorio en la implementación de disco — y aunque S3 no tiene "directorios" de verdad, una clave
 * así sería una fuente de bugs silenciosos el día que alguien la muestre en una URL. Validar una vez,
 * en el puerto, es la garantía de que ninguna implementación futura se olvida.
 */

/** Nace de fuera: quien encola declara `guardadoEn`, no `Date.now()` implícito (misma idea que en `jobs`). */
export interface MetadatosDeObjeto {
  readonly tamanoBytes: number;
  readonly sha256: string;
  readonly tipoDeContenido: string;
  readonly guardadoEn: string;
}

export interface ObjetoLeido {
  readonly contenido: Uint8Array;
  readonly meta: MetadatosDeObjeto;
}

export interface OpcionesDeGuardado {
  readonly tipoDeContenido: string;
  readonly ahora: string;
}

export interface AlmacenDeObjetos {
  guardar(
    clave: string,
    contenido: Uint8Array,
    opciones: OpcionesDeGuardado,
  ): Promise<MetadatosDeObjeto>;
  /** `undefined` si no existe. No lanza por ausencia: lanzar es para lo inesperado, no para "no está". */
  leer(clave: string): Promise<ObjetoLeido | undefined>;
  existe(clave: string): Promise<boolean>;
  /** Idempotente: borrar lo que no existe no es un error. */
  borrar(clave: string): Promise<void>;
  /** Claves que empiezan con `prefijo` (`''` para todas), en orden lexicográfico. */
  listar(prefijo: string): Promise<readonly string[]>;
}

/** Fallo de entrada: la clave no cumple la forma exigida. Ver `validarClave` para el detalle. */
export class ClaveInvalidaError extends Error {
  constructor(clave: string, motivo: string) {
    super(`clave de almacén inválida (${motivo}): ${JSON.stringify(clave)}`);
    this.name = 'ClaveInvalidaError';
  }
}

const LARGO_MAXIMO_DE_CLAVE = 1024; // el límite real de una clave de objeto S3

/**
 * Valida y normaliza una clave. Reglas, y por qué cada una:
 *
 *  · No vacía, no sólo espacios: una clave vacía en disco sería el propio directorio base.
 *  · Sin byte nulo: PostgreSQL, sistemas de ficheros y S3 lo rechazan cada uno a su manera distinta;
 *    mejor rechazarlo acá con un mensaje que entender tres errores de bajo nivel diferentes.
 *  · Sin `..` como segmento: es el escape de directorio clásico. Se comprueba por segmento
 *    (`clave.split('/')`) y no con un `includes('..')` ingenuo, porque un nombre de fichero legítimo
 *    como `"resumen..final.pdf"` contiene la subcadena `..` sin ser un intento de escape.
 *  · Sin `/` inicial: una clave "absoluta" no tiene sentido para un almacén de objetos con espacio de
 *    nombres plano; y en disco, `path.join(base, '/etc/passwd')` con Node normaliza distinto según la
 *    plataforma — más simple prohibirlo que confiar en esa normalización.
 *  · Máximo 1024 bytes UTF-8: el límite real de S3. Que la implementación de disco lo cumpla también
 *    es lo que hace que "cambiar a S3 el día de mañana" sea enchufar y no reescribir claves viejas.
 */
export function validarClave(clave: string): string {
  if (clave.length === 0) throw new ClaveInvalidaError(clave, 'vacía');
  if (clave.includes('\0')) throw new ClaveInvalidaError(clave, 'contiene un byte nulo');
  if (clave.startsWith('/')) throw new ClaveInvalidaError(clave, 'empieza por /');
  if (clave.endsWith('/')) throw new ClaveInvalidaError(clave, 'termina en /');
  if (clave.split('/').some((segmento) => segmento === '..' || segmento === '.')) {
    throw new ClaveInvalidaError(clave, 'contiene un segmento . o ..');
  }
  if (Buffer.byteLength(clave, 'utf8') > LARGO_MAXIMO_DE_CLAVE) {
    throw new ClaveInvalidaError(clave, `supera ${String(LARGO_MAXIMO_DE_CLAVE)} bytes UTF-8`);
  }
  return clave;
}

/**
 * La misma familia de comprobaciones que `validarClave`, pero para el argumento de `listar`: ahí
 * `''` significa "todo" y terminar en `/` es la forma normal de pedir "lo que cuelga de esta
 * carpeta" — ninguna de las dos cosas es válida como clave de un objeto concreto, pero ambas son
 * legítimas como prefijo de búsqueda.
 */
export function validarPrefijo(prefijo: string): string {
  if (prefijo === '') return prefijo;
  if (prefijo.includes('\0')) throw new ClaveInvalidaError(prefijo, 'contiene un byte nulo');
  if (prefijo.startsWith('/')) throw new ClaveInvalidaError(prefijo, 'empieza por /');
  if (prefijo.split('/').some((segmento) => segmento === '..' || segmento === '.')) {
    throw new ClaveInvalidaError(prefijo, 'contiene un segmento . o ..');
  }
  return prefijo;
}
