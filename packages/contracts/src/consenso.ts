/**
 * Contrato del sondeo tipo Pol.is: sembrar afirmaciones y valorarlas (ADR-0038, ADR-0048).
 *
 * ═══ Qué es esto y qué NO es ═══
 *
 * ADR-0038 lo dice con todas las letras: **un sondeo filtra la agenda, nunca decide**. No hay
 * ganador acá. Las tres piezas normativas que este contrato tiene que sostener:
 *
 *  1. **Voto trinario** (de acuerdo / en desacuerdo / paso), con `paso` como **dato observado** y
 *     no como «no contestó» — eso lo distingue el propio registro de la valoración: si no existe
 *     una fila, la persona no lo vio; si existe con `paso`, lo vio y no se pronunció.
 *  2. **Siembra fundacional obligatoria**: doce afirmaciones de quien convoca, al menos tres de
 *     las cuales tienen que contradecir su propia postura. El sondeo no se puede abrir a valorar
 *     sin cumplir las dos cifras a la vez.
 *  3. **Afirmación corta**: ≤280 caracteres. Acá no se delibera, se vota; el argumento largo tiene
 *     su lugar en la deliberación de la propuesta o el problema de origen, no en el sondeo.
 *
 * ═══ Frontera con `@koinonia/consensus` (ADR-0048) ═══
 *
 * Este fichero **no depende de `@koinonia/consensus`** — `contracts` no lo tiene como dependencia
 * y no debería tenerlo: el cálculo vive en el paquete, la forma de red vive acá, y la traducción
 * entre uno y otro es trabajo de la capa HTTP (`services/api/src/http/rutas-consenso.ts`), igual
 * que ya hace `consensoDto` para la otra pantalla que usa el mismo paquete.
 *
 * El resultado que este contrato expone **deliberadamente no manda el número crudo** de `GIC` ni
 * de dispersión (`AfirmacionPuntuada.metrica` en el paquete): ADR-0048 prohíbe que esa salida
 * alimente una comparación de umbral, y mandar el número por la red es la forma más fácil de que
 * alguien, en algún punto futuro, lo use para eso sin querer. El orden del arreglo ya dice el
 * ranking; el porcentaje por grupo ya dice el contenido. El número que lo produjo se queda en el
 * servidor.
 *
 * ═══ Lo que este contrato NO resuelve, a propósito (HANDOFF.md §8, tarea 15) ═══
 *
 * Nada de lo que hay acá escribe un evento al historial encadenado, ni fija una `AgendaDeConsenso
 * Congelada`, ni publica una huella de la matriz de entrada. Ese trabajo es grande y HANDOFF.md lo
 * deja abierto a propósito. El resultado que este contrato describe se marca `esProvisional: true`
 * con una frase que lo dice: es un cálculo recalculable, no un hecho del historial. Cuando esa
 * tarea se resuelva, lo que cambia es de dónde sale la matriz (del historial, no de una tabla
 * mutable) y qué pasa a publicarse además del resultado (el snapshot, la huella); las formas de
 * `sembrarAfirmacion` y `valorarAfirmacion` no tendrían por qué cambiar, porque describen el acto
 * de una persona, no la demostración de que quedó escrito.
 *
 * ═══ ADR-0050 (Propuesto, no aceptado) ═══
 *
 * El umbral de no-facción que separa «grupos detectados» de «no hay grupos claros» vive **dentro**
 * de `@koinonia/consensus` y este contrato no lo repite ni lo endurece: `sondeoResultado` sólo
 * declara los dos desenlaces posibles como variantes de una unión discriminada. Si ADR-0050 se
 * acepta algún día, sólo cambia el paquete de cálculo; esta forma de red no se entera.
 */

import { z } from 'zod';

import { instantMs, opaqueId, requestId } from './ids.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Constantes normativas (ADR-0038, PRODUCT.md §4)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Cuántas afirmaciones tiene que sembrar quien convoca antes de que el sondeo abra a valorar. */
export const SONDEO_MINIMO_AFIRMACIONES_SEMBRADAS = 12;

/** De esas, cuántas tienen que contradecir la propia postura de quien convoca. */
export const SONDEO_MINIMO_AFIRMACIONES_CONTRARIAS = 3;

/** Una afirmación de sondeo se vota, no se argumenta: cabe en dos líneas de un teléfono. */
export const SONDEO_MAXIMO_CARACTERES_AFIRMACION = 280;

/**
 * PRODUCT.md §4: «Menos de 7 votos: todavía no podemos ubicarte en el mapa».
 *
 * ADR-0048 dice sin rodeos que este filtro **no está implementado en `@koinonia/consensus`**
 * («no es competencia de este ADR»): el paquete agrupa a quien le entregan, sin mínimo propio. Por
 * eso el filtro se aplica **antes** de llamar al paquete, al construir la matriz —lo hace la capa
 * HTTP, no este contrato—, y una persona por debajo del mínimo simplemente no entra como fila.
 */
export const SONDEO_MINIMO_VALORACIONES_PARA_UBICAR = 7;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Vocabulario
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Voto trinario. `paso` es una respuesta, no un vacío: ver la nota de cabecera. */
export const respuestaSondeo = z.enum(['de_acuerdo', 'en_desacuerdo', 'paso']);
export type RespuestaSondeo = z.infer<typeof respuestaSondeo>;

export const RESPUESTA_SONDEO_EN_PALABRAS: Readonly<Record<RespuestaSondeo, string>> = {
  de_acuerdo: 'De acuerdo',
  en_desacuerdo: 'En desacuerdo',
  paso: 'Paso',
};

export const estadoSondeo = z.enum(['sembrando', 'abierto', 'cerrado']);
export type EstadoSondeo = z.infer<typeof estadoSondeo>;

/** Cómo se dice cada estado en pantalla. Una sola redacción, igual que `ESTADO_PROBLEMA_EN_PALABRAS`. */
export const ESTADO_SONDEO_EN_PALABRAS: Readonly<Record<EstadoSondeo, string>> = {
  sembrando: 'Armando el sondeo',
  abierto: 'Abierto para valorar',
  cerrado: 'Cerrado',
};

/** Sobre qué se abre un sondeo: siempre un asunto ya escrito, nunca un tema suelto. */
export const asuntoSondeo = z.enum(['problema', 'propuesta']);
export type AsuntoSondeo = z.infer<typeof asuntoSondeo>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Escritura
// ═════════════════════════════════════════════════════════════════════════════════════════════

const textoAfirmacionSondeo = z
  .string()
  .min(10, 'Contá la afirmación en una frase completa.')
  .max(
    SONDEO_MAXIMO_CARACTERES_AFIRMACION,
    'Acá no se delibera, se vota: si hace falta más espacio para decirlo, es un aporte para la ' +
      'deliberación, no una afirmación de sondeo.',
  );

/** Abrir un sondeo es un acto de procedimiento: queda a nombre de quien convoca y con su motivo. */
export const abrirSondeo = z
  .object({
    requestId,
    asuntoId: opaqueId,
    asuntoTipo: asuntoSondeo,
    /** Por qué este asunto califica: controvertido, o con propuestas contradictorias en circulación. */
    motivo: z
      .string()
      .min(
        20,
        'Decí por qué este asunto es controvertido o tiene propuestas contradictorias en circulación.',
      )
      .max(500),
  })
  .strict();
export type AbrirSondeo = z.infer<typeof abrirSondeo>;

/**
 * Sembrar una afirmación.
 *
 * `contrariaAMiPosicion` sólo tiene efecto normativo mientras quien convoca siembra la fundacional
 * de doce (ADR-0038): ahí es obligatorio decirlo, uno por uno, porque de esas doce al menos tres
 * tienen que contradecir la propia postura. Una vez el sondeo abre a valorar, cualquier persona
 * puede sembrar afirmaciones nuevas —es el mecanismo antitrol que describe la cabecera de
 * ADR-0038: frente a algo que molesta, la única salida estructural es escribir una afirmación que
 * gane acuerdo de gente que no piensa igual— y ahí el campo no aplica: no hay «postura de quien
 * convoca» de la que hablar para un aporte que no es suyo. Por eso es opcional en la forma y la
 * capa de aplicación decide cuándo exigirlo.
 */
export const sembrarAfirmacion = z
  .object({
    requestId,
    texto: textoAfirmacionSondeo,
    contrariaAMiPosicion: z.boolean().optional(),
  })
  .strict();
export type SembrarAfirmacion = z.infer<typeof sembrarAfirmacion>;

/** Valorar una afirmación ya sembrada. Nada más: ni comentario, ni respuesta a nadie (ADR-0038). */
export const valorarAfirmacion = z.object({ requestId, respuesta: respuestaSondeo }).strict();
export type ValorarAfirmacion = z.infer<typeof valorarAfirmacion>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lectura
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const afirmacionSondeo = z.object({
  id: opaqueId,
  texto: z.string(),
  /** `true` si la escribiste vos. No lleva el autor de nadie más: el sondeo no es un hilo (ADR-0038). */
  sembradaPorMi: z.boolean(),
  /** `true` sólo si es una de las doce fundacionales y quien convocó la marcó como contraria. */
  contrariaALaPosicionDeQuienConvoca: z.boolean(),
  /** Ausente si todavía no la valoraste. */
  miValoracion: respuestaSondeo.optional(),
});
export type AfirmacionSondeo = z.infer<typeof afirmacionSondeo>;

export const progresoSiembra = z.object({
  sembradas: z.number().int().nonnegative(),
  faltan: z.number().int().nonnegative(),
  contrariasSembradas: z.number().int().nonnegative(),
  contrariasFaltan: z.number().int().nonnegative(),
});
export type ProgresoSiembra = z.infer<typeof progresoSiembra>;

export const sondeoResumen = z.object({
  id: opaqueId,
  asuntoId: opaqueId,
  asuntoTipo: asuntoSondeo,
  asuntoTitulo: z.string(),
  motivo: z.string(),
  estado: estadoSondeo,
  estadoEnPalabras: z.string(),
  /** `true` si vos lo abriste. */
  convocaEsMi: z.boolean(),
  totalAfirmaciones: z.number().int().nonnegative(),
  totalValoraciones: z.number().int().nonnegative(),
  desde: instantMs,
});
export type SondeoResumen = z.infer<typeof sondeoResumen>;

export const sondeoDetalle = sondeoResumen.extend({
  /** Presente sólo en `sembrando`: la barra de progreso de la fundacional de doce y tres. */
  progresoSiembra: progresoSiembra.optional(),
  /**
   * La siguiente afirmación para valorar, una por vez (PRODUCT.md §4: «una afirmación corta a la
   * vez»). Ausente si ya no queda ninguna por valorar hoy, o si el sondeo sigue en `sembrando`.
   */
  siguienteAfirmacion: afirmacionSondeo.optional(),
  miProgreso: z.object({
    valoradas: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});
export type SondeoDetalle = z.infer<typeof sondeoDetalle>;

export const sondeos = z.array(sondeoResumen);
export type Sondeos = z.infer<typeof sondeos>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Resultado
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Una afirmación ya puntuada, tal como se muestra: sin el número crudo que la ordenó (ver la nota
 * de cabecera sobre por qué `metrica`/`GIC` no viaja).
 */
export const afirmacionResultadoSondeo = z.object({
  texto: z.string(),
  /** `%` de acuerdo por grupo, en el mismo orden que `grupos`. Redondeado para pantalla. */
  porcentajeAcuerdoPorGrupo: z.array(z.number().min(0).max(100)),
  observaciones: z.number().int().nonnegative(),
});
export type AfirmacionResultadoSondeo = z.infer<typeof afirmacionResultadoSondeo>;

export const grupoSondeo = z.object({
  /** «Grupo 1», «Grupo 2»… nunca un nombre editorial automático (ADR-0038: la etiqueta es humana). */
  nombre: z.string(),
  tamano: z.number().int().nonnegative(),
});
export type GrupoSondeo = z.infer<typeof grupoSondeo>;

/**
 * Los tres desenlaces que la pantalla tiene que saber pintar, ya discriminados por `tipo` para que
 * el compilador obligue a contemplar los tres (mismo criterio que `ResultadoAnalisis` en el paquete
 * de cálculo, ADR-0048).
 *
 * `esProvisional` viaja en los tres: ver la nota de cabecera sobre la tarea 15 de HANDOFF.md.
 */
export const sondeoResultado = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('grupos_detectados'),
    esProvisional: z.literal(true),
    avisoProvisional: z.string(),
    participantesConsiderados: z.number().int().nonnegative(),
    participantesSinUbicar: z.number().int().nonnegative(),
    titulo: z.string(),
    descripcion: z.string(),
    grupos: z.array(grupoSondeo),
    /** «Grupo 2» en palabras, o ausente si no votaste lo suficiente para ubicarte. */
    miGrupo: z.string().optional(),
    afirmacionesPuenteTitulo: z.string(),
    afirmacionesPuenteDescripcion: z.string(),
    afirmacionesPuente: z.array(afirmacionResultadoSondeo),
    afirmacionesDivisivasTitulo: z.string(),
    afirmacionesDivisivasDescripcion: z.string(),
    afirmacionesDivisivas: z.array(afirmacionResultadoSondeo),
  }),
  z.object({
    tipo: z.literal('sin_grupos_claros'),
    esProvisional: z.literal(true),
    avisoProvisional: z.string(),
    participantesConsiderados: z.number().int().nonnegative(),
    participantesSinUbicar: z.number().int().nonnegative(),
    titulo: z.string(),
    descripcion: z.string(),
    acuerdoGeneralTitulo: z.string(),
    acuerdoGeneralDescripcion: z.string(),
    acuerdoGeneral: z.array(afirmacionResultadoSondeo),
    /** Frase cuando ni el acuerdo general destaca nada. `''` si sí hay algo que mostrar. */
    aviso: z.string(),
  }),
  z.object({
    tipo: z.literal('todavia_no'),
    /** Por qué todavía no hay resultado. Cada motivo tiene su frase propia en pantalla. */
    motivo: z.enum(['sembrando', 'poca_gente', 'sin_diferencias', 'no_se_estabilizo']),
    descripcion: z.string(),
  }),
]);
export type SondeoResultado = z.infer<typeof sondeoResultado>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Rechazos, dichos para quien los lee (mismo criterio que `MENSAJES_DELIBERACION` en `http.ts`)
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const MENSAJES_SONDEO: Readonly<Record<string, string>> = {
  SONDEO_NO_ENCONTRADO:
    'No encontramos ese sondeo. Puede que se haya movido o que el enlace esté viejo.',
  AFIRMACION_NO_ENCONTRADA: 'Esa afirmación no está en este sondeo.',
  ASUNTO_NO_ENCONTRADO:
    'No encontramos el problema o la propuesta sobre la que querés abrir el sondeo.',
  SIEMBRA_SOLO_QUIEN_CONVOCA:
    'Mientras el sondeo se arma, sólo quien lo convocó puede sembrar afirmaciones. En cuanto abra ' +
    'para valorar, cualquiera puede sumar las suyas.',
  SIEMBRA_DEBE_DECLARAR_SI_ES_CONTRARIA:
    'De las doce afirmaciones fundacionales tenés que decir, una por una, si contradice tu propia ' +
    'postura. Al menos tres tienen que serlo.',
  SONDEO_TODAVIA_SEMBRANDO:
    'Este sondeo todavía se está armando: faltan afirmaciones fundacionales antes de que se pueda ' +
    'valorar algo.',
  SONDEO_CERRADO:
    'Este sondeo ya cerró. Podés ver el resultado, pero no se puede sembrar ni valorar nada más.',
} as const;
