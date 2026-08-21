/**
 * Catálogo de hallazgos, **en castellano y para alguien que no sabe qué es un hash**.
 *
 * Este fichero es la mitad del valor del verificador. Un programa que imprime
 * `event-hash-mismatch at leaf 8412` no le sirve a la persona que tiene que decidir si convoca a la
 * veeduría. Cada hallazgo lleva tres cosas y ninguna es opcional:
 *
 *  - **qué pasó**, en una frase sin jerga;
 *  - **qué significa**, es decir, qué se puede y qué no se puede concluir de ello;
 *  - **qué hacer**, porque un diagnóstico sin conducta es ruido.
 *
 * Y hay una regla de honestidad que atraviesa los textos: nunca se afirma más de lo comprobado. Un
 * fallo de integridad interna NO prueba mala fe —puede ser un disco defectuoso—, y decir lo
 * contrario entrenaría a la asamblea a desconfiar del verificador el día que se equivoque.
 */

export type Severidad = 'alarma' | 'aviso' | 'nota';

export type CodigoHallazgo =
  // ── El export en sí ────────────────────────────────────────────────────────────────────────
  | 'EXPORT_INCOMPLETO'
  | 'FICHERO_ALTERADO'
  | 'FORMATO_DESCONOCIDO'
  // ── Integridad interna ─────────────────────────────────────────────────────────────────────
  | 'EVENTO_NO_CANONICO'
  | 'REGISTRO_ALTERADO'
  | 'CADENA_ROTA'
  | 'HUECO_EN_EL_INDICE'
  | 'COLA_TRUNCADA'
  | 'ESPINA_AUSENTE'
  | 'PUNTERO_COLGANTE'
  | 'AGREGADO_NO_REGISTRADO'
  | 'CABEZA_INCOHERENTE'
  // ── Checkpoints ────────────────────────────────────────────────────────────────────────────
  | 'CHECKPOINT_INCOHERENTE'
  | 'RAIZ_MERKLE_NO_COINCIDE'
  | 'RAIZ_DE_CABEZAS_NO_COINCIDE'
  | 'CADENA_DE_CHECKPOINTS_ROTA'
  | 'CHECKPOINT_SIN_RESPALDO'
  | 'PRUEBA_DE_CONSISTENCIA_INVALIDA'
  | 'PRUEBA_DE_CONSISTENCIA_AUSENTE'
  // ── Anclaje ────────────────────────────────────────────────────────────────────────────────
  | 'ANCLAJE_INVALIDO'
  | 'ANCLAJE_NO_CORRESPONDE'
  | 'SIN_QUORUM_DE_ANCLAJE'
  | 'SIN_ANCLAJE'
  | 'RAIZ_DE_CONFIANZA_DEL_EXPORT';

export interface DescripcionHallazgo {
  readonly severidad: Severidad;
  readonly titulo: string;
  readonly queSignifica: string;
  readonly queHacer: string;
}

export const CATALOGO: Record<CodigoHallazgo, DescripcionHallazgo> = {
  EXPORT_INCOMPLETO: {
    severidad: 'alarma',
    titulo: 'Al paquete le faltan piezas.',
    queSignifica:
      'No están todos los ficheros que el formato exige, así que hay comprobaciones que ni ' +
      'siquiera se pudieron intentar. Un paquete incompleto no es un paquete correcto: es un ' +
      'paquete del que no se sabe nada.',
    queHacer:
      'Volvé a descargarlo. Si sigue incompleto, pedile a la veeduría que lo genere de nuevo.',
  },
  FICHERO_ALTERADO: {
    severidad: 'aviso',
    titulo: 'Un fichero no coincide con lo que el propio paquete dice que debería ser.',
    queSignifica:
      'El índice del paquete anota un resumen de cada fichero y uno no cuadra. Lo más probable es ' +
      'una descarga a medias. OJO: esta comprobación NO protege contra quien produjo el paquete —si ' +
      'alterase un fichero, actualizaría también el índice—. Lo que sí protege es todo lo demás.',
    queHacer: 'Descargá el paquete otra vez y repetí la comprobación.',
  },
  FORMATO_DESCONOCIDO: {
    severidad: 'alarma',
    titulo: 'Este paquete está en un formato que esta versión no entiende.',
    queSignifica:
      'Ni bueno ni malo: sencillamente no se puede leer con esta herramienta, y por tanto no se ' +
      'comprobó nada.',
    queHacer: 'Actualizá el verificador (`npx @koinonia/verificar@latest`) y volvé a intentarlo.',
  },

  EVENTO_NO_CANONICO: {
    severidad: 'alarma',
    titulo: 'Un registro está escrito de una forma distinta de la que se usó para sellarlo.',
    queSignifica:
      'El sistema fija una única manera de escribir cada registro, para que su resumen se pueda ' +
      'recalcular en cualquier ordenador. Este registro no la respeta: le sobra un espacio, tiene ' +
      'las claves en otro orden o repite alguna. Suele ser el rastro de una copia de seguridad ' +
      'restaurada de mala manera; también puede ser una edición a mano.',
    queHacer: 'Guardá este paquete sin modificarlo y avisá a la veeduría.',
  },
  REGISTRO_ALTERADO: {
    severidad: 'alarma',
    titulo: 'Un registro fue modificado después de haberse escrito.',
    queSignifica:
      'Cada registro lleva un resumen calculado sobre su contenido exacto. El contenido de éste ya ' +
      'no produce el resumen que quedó guardado, así que cambió después. Esto no debería ocurrir ' +
      'nunca: ni un error de disco produce un cambio así de limpio.',
    queHacer:
      'Guardá este paquete tal cual, anotá la fecha y avisá a la veeduría HOY. No borres nada.',
  },
  CADENA_ROTA: {
    severidad: 'alarma',
    titulo: 'La secuencia de un expediente está rota.',
    queSignifica:
      'Los registros de cada expediente van encadenados: cada uno menciona al anterior. Aquí la ' +
      'cadena se corta, lo que significa que se quitó, se insertó o se cambió de sitio algún ' +
      'registro intermedio.',
    queHacer: 'Guardá el paquete y avisá a la veeduría, indicando el expediente que aparece abajo.',
  },
  HUECO_EN_EL_INDICE: {
    severidad: 'alarma',
    titulo: 'Faltan registros en medio de la historia.',
    queSignifica:
      'Los registros se numeran sin saltos, uno detrás de otro y sin excepciones. Faltan números en ' +
      'medio, y eso sólo puede pasar si alguien borró. No vale la excusa de "fue un fallo técnico": ' +
      'el sistema está construido para que un fallo técnico no deje huecos.',
    queHacer: 'Guardá el paquete y avisá a la veeduría HOY. Los números que faltan están abajo.',
  },
  COLA_TRUNCADA: {
    severidad: 'alarma',
    titulo: 'Se cortó el FINAL de la historia: faltan los últimos registros.',
    queSignifica:
      'Borrar el final no deja huecos —la historia sigue pareciendo continua—, así que se detecta de ' +
      'otra forma: el sistema lleva la cuenta de cuántos números repartió, y repartió más de los que ' +
      'aquí aparecen. Alguien recortó lo más reciente, que es justo lo que interesa recortar cuando ' +
      'se quiere borrar algo que acaba de ocurrir.',
    queHacer: 'Guardá el paquete y avisá a la veeduría HOY.',
  },
  ESPINA_AUSENTE: {
    severidad: 'alarma',
    titulo: 'Falta el registro fundacional del sistema.',
    queSignifica:
      'Todos los expedientes cuelgan de un primer registro que abre el libro. Sin él no hay de dónde ' +
      'colgar nada, y no se puede comprobar que ningún expediente sea legítimo.',
    queHacer: 'El paquete no sirve como prueba. Avisá a la veeduría.',
  },
  PUNTERO_COLGANTE: {
    severidad: 'alarma',
    titulo: 'Un expediente entero desapareció.',
    queSignifica:
      'El libro anota el nacimiento de cada expediente. Aquí consta que nació uno y no queda ni ' +
      'rastro de él, o el que queda no es el mismo. Es lo que ocurre cuando se borra una propuesta ' +
      'completa, y también cuando se reescribe entera desde cero: por dentro quedaría perfecta, pero ' +
      'su partida de nacimiento ya no coincide.',
    queHacer: 'Guardá el paquete y avisá a la veeduría HOY. El expediente afectado aparece abajo.',
  },
  AGREGADO_NO_REGISTRADO: {
    severidad: 'alarma',
    titulo: 'Hay un expediente que el libro nunca registró.',
    queSignifica:
      'Existen registros de un expediente cuyo nacimiento no consta. Entró por una vía que no es la ' +
      'normal: alguien escribió directamente en la base de datos.',
    queHacer: 'Guardá el paquete y avisá a la veeduría.',
  },
  CABEZA_INCOHERENTE: {
    severidad: 'alarma',
    titulo: 'El resumen de un expediente no coincide con sus registros.',
    queSignifica:
      'El sistema guarda, por comodidad, el estado final de cada expediente. Aquí ese resumen no es ' +
      'el que sale de recorrer los registros uno a uno. Manda lo segundo.',
    queHacer: 'Avisá a la veeduría; indicá el expediente que aparece abajo.',
  },

  CHECKPOINT_INCOHERENTE: {
    severidad: 'alarma',
    titulo: 'Un sello periódico no cuadra consigo mismo.',
    queSignifica:
      'Cada cierto tiempo el sistema publica un sello que resume toda la historia hasta ese momento. ' +
      'El identificador de este sello no es el que sale de recalcularlo con sus propios datos: fue ' +
      'modificado.',
    queHacer: 'Guardá el paquete y avisá a la veeduría.',
  },
  RAIZ_MERKLE_NO_COINCIDE: {
    severidad: 'alarma',
    titulo: 'Un sello periódico no corresponde a la historia que acompaña.',
    queSignifica:
      'El sello resume todos los registros anteriores en un solo valor. Al recalcularlo con los ' +
      'registros de este paquete sale otro. O bien cambiaron registros del pasado, o bien el sello ' +
      'es inventado. Este hallazgo es exactamente el ataque de "reescribir el pasado y publicar un ' +
      'sello nuevo que parezca coherente".',
    queHacer: 'Guardá el paquete y avisá a la veeduría HOY.',
  },
  RAIZ_DE_CABEZAS_NO_COINCIDE: {
    severidad: 'alarma',
    titulo: 'El censo de expedientes que declara un sello no es el real.',
    queSignifica:
      'Además de los registros, cada sello resume el censo de expedientes abiertos y su estado. ' +
      'El censo recalculado no coincide, que es lo que ocurre si se hizo desaparecer un expediente ' +
      'entero antes de sellar.',
    queHacer: 'Guardá el paquete y avisá a la veeduría HOY.',
  },
  CADENA_DE_CHECKPOINTS_ROTA: {
    severidad: 'alarma',
    titulo: 'Los sellos periódicos no se encadenan entre sí.',
    queSignifica:
      'Cada sello menciona al anterior. Aquí uno menciona a un sello que no es el que le precede, o ' +
      'no menciona ninguno cuando debería. Falta un sello de la serie, o se sustituyó.',
    queHacer: 'Guardá el paquete y avisá a la veeduría.',
  },
  CHECKPOINT_SIN_RESPALDO: {
    severidad: 'alarma',
    titulo: 'Un sello dice resumir más registros de los que hay.',
    queSignifica:
      'El sello afirma cubrir cierto número de registros y en el paquete no llegan a tantos. Los ' +
      'registros que faltan son precisamente los que el sello prueba que existieron.',
    queHacer: 'Guardá el paquete y avisá a la veeduría HOY.',
  },
  PRUEBA_DE_CONSISTENCIA_INVALIDA: {
    severidad: 'alarma',
    titulo: 'La prueba de que un sello continúa al anterior es falsa.',
    queSignifica:
      'Entre dos sellos consecutivos se publica una prueba matemática de que el segundo sólo AÑADE ' +
      'registros al primero, sin cambiar ni quitar ninguno. Esta prueba no se sostiene: entre uno y ' +
      'otro se tocó el pasado.',
    queHacer: 'Guardá el paquete y avisá a la veeduría HOY.',
  },
  PRUEBA_DE_CONSISTENCIA_AUSENTE: {
    severidad: 'aviso',
    titulo: 'Falta la prueba de continuidad entre dos sellos.',
    queSignifica:
      'La continuidad se pudo comprobar recalculándola con los registros del propio paquete, así que ' +
      'aquí no hay nada torcido. Pero quien sólo conserve un sello antiguo y no la historia entera no ' +
      'podrá comprobarlo por su cuenta, y ésa es justamente la gente a la que la prueba protege.',
    queHacer: 'Pedile a la veeduría que incluya las pruebas de continuidad en el próximo paquete.',
  },

  ANCLAJE_INVALIDO: {
    severidad: 'alarma',
    titulo: 'Un comprobante de registro externo es falso.',
    queSignifica:
      'Para que la historia no dependa de este servidor, su resumen se registra fuera: en Bitcoin, ' +
      'en repositorios públicos firmados y en los buzones de varias personas. Uno de esos ' +
      'comprobantes no resiste la comprobación: está manipulado, o firmado por quien no debía.',
    queHacer: 'Guardá el paquete y avisá a la veeduría HOY. El motivo exacto aparece abajo.',
  },
  ANCLAJE_NO_CORRESPONDE: {
    severidad: 'alarma',
    titulo: 'Lo que se registró fuera NO es esta historia.',
    queSignifica:
      'El comprobante externo es auténtico, pero se refiere a un resumen distinto del que produce la ' +
      'historia de este paquete. Es la señal más fuerte que este programa puede darte: significa que ' +
      'la historia cambió DESPUÉS de haberse registrado fuera, y quien la cambió no pudo cambiar el ' +
      'registro externo porque no lo controla.',
    queHacer:
      'Guardá el paquete, no lo modifiques, y avisá a la veeduría HOY. Esto no se explica por un ' +
      'error técnico.',
  },
  SIN_QUORUM_DE_ANCLAJE: {
    severidad: 'aviso',
    titulo: 'Falta la confirmación externa.',
    queSignifica:
      'Las cuentas internas cuadran, pero el resumen todavía no quedó registrado en dos sitios ' +
      'independientes fuera de este servidor. Eso significa que lo ocurrido desde el último registro ' +
      'externo AÚN NO ESTÁ PROTEGIDO contra una alteración hecha desde dentro. No es prueba de que ' +
      'algo esté mal; sí es motivo para avisar.',
    queHacer:
      'Si esto lleva más de un día así, avisá a la veeduría. Si lleva más de tres, las decisiones ' +
      'de ese lapso quedan pendientes de confirmación de integridad.',
  },
  SIN_ANCLAJE: {
    severidad: 'aviso',
    titulo: 'Este paquete no trae ningún comprobante de registro externo.',
    queSignifica:
      'Todas las comprobaciones internas cuadran, pero cuadran POR CONSTRUCCIÓN: quien controla el ' +
      'servidor puede reescribir la historia entera y recalcular todo para que sea coherente. Sin ' +
      'comprobantes externos, este verde sólo dice que el paquete es coherente consigo mismo, que es ' +
      'mucho menos de lo que parece.',
    queHacer: 'Pedile a la veeduría un paquete que incluya los comprobantes de registro externo.',
  },
  RAIZ_DE_CONFIANZA_DEL_EXPORT: {
    severidad: 'aviso',
    titulo: 'La lista de firmantes salió del propio paquete.',
    queSignifica:
      'Para comprobar las firmas hace falta saber de quién son las claves legítimas. Esa lista se ' +
      'tomó del propio paquete, y quien produjo el paquete pudo ponerla. Es como comprobar un carné ' +
      'contra la lista que trae el propio carné. Las firmas son válidas; lo que no se probó es que ' +
      'sean de quien dice.',
    queHacer:
      'Pedile a la veeduría su lista de claves por otro canal y volvé a ejecutar con ' +
      '`--confianza <fichero>`.',
  },
};

/**
 * Un hallazgo concreto, con dónde ocurrió.
 *
 * Los campos de localización admiten `undefined` explícito —y no sólo la ausencia de la clave—
 * porque un hallazgo es un **registro de diagnóstico**, no una preimagen: aquí `undefined` significa
 * «no aplica a este hallazgo», y obligar a construirlo con `spread` condicional en veinte sitios
 * sólo produciría ruido. Donde sí importa la diferencia entre ausente y nulo es en los eventos y en
 * los recibos, y allí está aplicada.
 */
export interface Hallazgo {
  readonly codigo: CodigoHallazgo;
  /** Detalle técnico, para el acta. Va debajo del texto llano, no en su lugar. */
  readonly detalle: string;
  readonly agregado?: string | undefined;
  readonly leafIndex?: number | undefined;
  readonly seq?: number | undefined;
  readonly treeSize?: number | undefined;
  readonly esperado?: string | undefined;
  readonly obtenido?: string | undefined;
}

export function severidadDe(codigo: CodigoHallazgo): Severidad {
  return CATALOGO[codigo].severidad;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Códigos de salida
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Uno por **tipo** de fallo, para que un guion pueda reaccionar distinto sin leer el texto.
 * El mayor de los aplicables gana: si hay manipulación interna Y falta anclaje, sale 3.
 */
export const SALIDA = {
  /** Todo cuadra y el anclaje es firme. */
  ok: 0,
  /** Error de uso: faltan argumentos, la ruta no existe. */
  uso: 1,
  /** El paquete no se puede leer o le faltan piezas. */
  exportIlegible: 2,
  /** Falta la confirmación externa. Ámbar: íntegro pero no anclado. */
  sinAnclajeFirme: 3,
  /** Un comprobante externo es falso o no corresponde a esta historia. */
  anclajeInvalido: 4,
  /** Los sellos periódicos no cuadran con la historia. */
  checkpoints: 5,
  /** La historia está manipulada por dentro. */
  integridadInterna: 6,
} as const;

export type CodigoSalida = (typeof SALIDA)[keyof typeof SALIDA];

const GRUPO: Record<CodigoHallazgo, CodigoSalida> = {
  EXPORT_INCOMPLETO: SALIDA.exportIlegible,
  FICHERO_ALTERADO: SALIDA.exportIlegible,
  FORMATO_DESCONOCIDO: SALIDA.exportIlegible,

  EVENTO_NO_CANONICO: SALIDA.integridadInterna,
  REGISTRO_ALTERADO: SALIDA.integridadInterna,
  CADENA_ROTA: SALIDA.integridadInterna,
  HUECO_EN_EL_INDICE: SALIDA.integridadInterna,
  COLA_TRUNCADA: SALIDA.integridadInterna,
  ESPINA_AUSENTE: SALIDA.integridadInterna,
  PUNTERO_COLGANTE: SALIDA.integridadInterna,
  AGREGADO_NO_REGISTRADO: SALIDA.integridadInterna,
  CABEZA_INCOHERENTE: SALIDA.integridadInterna,

  CHECKPOINT_INCOHERENTE: SALIDA.checkpoints,
  RAIZ_MERKLE_NO_COINCIDE: SALIDA.checkpoints,
  RAIZ_DE_CABEZAS_NO_COINCIDE: SALIDA.checkpoints,
  CADENA_DE_CHECKPOINTS_ROTA: SALIDA.checkpoints,
  CHECKPOINT_SIN_RESPALDO: SALIDA.checkpoints,
  PRUEBA_DE_CONSISTENCIA_INVALIDA: SALIDA.checkpoints,
  PRUEBA_DE_CONSISTENCIA_AUSENTE: SALIDA.sinAnclajeFirme,

  ANCLAJE_INVALIDO: SALIDA.anclajeInvalido,
  ANCLAJE_NO_CORRESPONDE: SALIDA.anclajeInvalido,
  SIN_QUORUM_DE_ANCLAJE: SALIDA.sinAnclajeFirme,
  SIN_ANCLAJE: SALIDA.sinAnclajeFirme,
  RAIZ_DE_CONFIANZA_DEL_EXPORT: SALIDA.sinAnclajeFirme,
};

export function salidaPara(hallazgos: readonly Hallazgo[]): CodigoSalida {
  let peor: CodigoSalida = SALIDA.ok;
  for (const hallazgo of hallazgos) {
    const codigo = GRUPO[hallazgo.codigo];
    if (codigo > peor) peor = codigo;
  }
  return peor;
}
