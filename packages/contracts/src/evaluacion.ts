/**
 * Contrato de frontera para el cierre del ciclo (ADR-0053): evaluación, resultado y aprendizajes.
 *
 * `problema → deliberación → decisión → iniciativa → tareas → resultado → aprendizaje`. Este
 * fichero es el tramo final: contrastar lo que se prometió (los criterios congelados en el plan de
 * ejecución, ADR-0043) contra lo que pasó de verdad, y dejar constancia de lo aprendido.
 *
 * ═══ Tres cosas que el dominio impone y que este contrato refleja, no decide ═══
 *
 *  - **El desenlace no se manda, se lee.** No hay ningún esquema aquí con un campo «resultado» que
 *    alguien rellene: `publicarResultado` sólo lleva `requestId`. El desenlace lo calcula el motor a
 *    partir de los veredictos ya anotados (`packages/domain/src/evaluation`), nunca lo afirma quien
 *    publica.
 *  - **Afirmar cuesta, negar no.** `valorarCriterio` acepta `veredicto: 'cumplido'` sin que este
 *    contrato exija nada adicional; es el motor el que exige evidencia verificada y el hecho que la
 *    sostiene, y lo rechaza si falta. Aquí no se duplica esa regla: se deja pasar y se traduce el
 *    rechazo cuando llega.
 *  - **Nadie aparece.** Ningún esquema de este fichero admite un identificador de persona (ADR-0040).
 *    El incumplimiento escala sobre la tarea, el acuerdo o la carga del círculo, nunca sobre alguien.
 *
 * ═══ Por qué `hechoQueLoSostieneId` y no «el identificador del evento» ═══
 *
 * La regla de oro (ADR-0041, `glossary.ts`) prohíbe la palabra que el motor usa internamente para
 * «lo que quedó escrito». En pantalla —y por tanto en cualquier nombre de campo que pueda acabar
 * mostrado tal cual— se dice «el hecho», que es exactamente su traducción en `GLOSSARY`.
 */

import {
  AGREEMENT_DISPOSITIONS,
  CRITERION_VERDICTS,
  ESCALATION_RUNGS,
  ESCALATION_TARGET_KINDS,
  EVALUATION_OUTCOMES,
  LEARNING_KINDS,
  MAX_LEARNING_STATEMENT_LENGTH,
  MAX_LEARNING_TAGS,
  MIN_LEARNING_STATEMENT_LENGTH,
  OUTCOME_CRITERION_EVIDENCE,
} from '@koinonia/domain';
import { z } from 'zod';

import { instantMs, opaqueId, requestId } from './ids.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Vocabularios cerrados
//
// Cada `z.enum` se construye desde la constante del dominio y no desde una lista escrita a mano:
// `packages/contracts/test/evaluacion.test.ts` ya no hace falta que compare las dos listas porque
// sólo hay una. La duplicación es exactamente la forma en que este vocabulario se desviaba antes.
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Qué pasó con un criterio. Nunca con una persona. */
export const veredictoCriterio = z.enum(CRITERION_VERDICTS);
export type VeredictoCriterio = z.infer<typeof veredictoCriterio>;

/** Qué tan comprobada está la evidencia detrás de un veredicto (ADR-0045). */
export const evidenciaCriterio = z.enum(OUTCOME_CRITERION_EVIDENCE);
export type EvidenciaCriterio = z.infer<typeof evidenciaCriterio>;

/** El desenlace. Siempre **leído**, nunca escrito por quien pide. */
export const desenlaceEvaluacion = z.enum(EVALUATION_OUTCOMES);
export type DesenlaceEvaluacion = z.infer<typeof desenlaceEvaluacion>;

/** Qué se hace con el acuerdo al cerrar (ADR-0033). */
export const disposicionAcuerdo = z.enum(AGREEMENT_DISPOSITIONS);
export type DisposicionAcuerdo = z.infer<typeof disposicionAcuerdo>;

/**
 * Los dos únicos escalones que una evaluación puede pulsar, y en este orden: primero se pregunta,
 * y sólo si la pregunta no alcanza se lleva al colectivo (ADR-0040). Los demás escalones de la
 * escalera completa los mueve la tarea, y sólo quien la asumió. `dominio-suspendido` no está en
 * `ESCALATION_RUNGS` y por tanto tampoco puede estar aquí.
 */
export const escalonEvaluacion = z.enum(ESCALATION_RUNGS);
export type EscalonEvaluacion = z.infer<typeof escalonEvaluacion>;

/** Sobre qué escala el incumplimiento. Los tres son objetos, no personas. */
export const objetoDeEscalada = z.enum(ESCALATION_TARGET_KINDS);
export type ObjetoDeEscalada = z.infer<typeof objetoDeEscalada>;

/** De qué habla un aprendizaje. Ninguna casilla lleva nombre propio. */
export const tipoDeAprendizaje = z.enum(LEARNING_KINDS);
export type TipoDeAprendizaje = z.infer<typeof tipoDeAprendizaje>;

/**
 * Lo que ve quien lee, incluido el estado que **nadie escribe**: una evaluación cuyo resultado
 * publicado no corresponde a sus propios hechos (ADR-0026). No es un error de datos: es un
 * incidente, y se dice así, sin ocultarlo detrás de un desenlace normal.
 */
export const estadoDeEvaluacion = z.enum([
  'en-curso',
  'publicada',
  'cerrada',
  'anulada-por-inconsistencia',
]);
export type EstadoDeEvaluacion = z.infer<typeof estadoDeEvaluacion>;

/** Etiqueta de recuperación de un aprendizaje: `[a-z][a-z0-9_]{0,31}`. */
export const etiquetaDeAprendizaje = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,31}$/u, 'una etiqueta se escribe en minúscula, sin espacios ni tildes');
export type EtiquetaDeAprendizaje = z.infer<typeof etiquetaDeAprendizaje>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lo que se manda
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Convoca la revisión. Sin criterios, sin fecha, sin desenlace: los tres salen del plan de
 * ejecución que la iniciativa lleva sellado desde su creación (ADR-0043), nunca de quien convoca.
 */
export const abrirEvaluacion = z.object({ requestId }).strict();
export type AbrirEvaluacion = z.infer<typeof abrirEvaluacion>;

/**
 * Valora un criterio contra su evidencia. `hechoQueLoSostieneId` sólo tiene sentido —y el motor lo
 * exige— cuando el veredicto es `cumplido`: afirmar que algo se logró cuesta un hecho, negar que se
 * logró no cuesta nada.
 */
export const valorarCriterio = z
  .object({
    requestId,
    veredicto: veredictoCriterio,
    evidencia: evidenciaCriterio,
    hechoQueLoSostieneId: opaqueId.optional(),
  })
  .strict();
export type ValorarCriterio = z.infer<typeof valorarCriterio>;

/**
 * Pulsa un escalón sobre la tarea, el acuerdo o la carga. `tareaId` es obligatorio cuando
 * `objeto: 'tarea'` y prohibido en cualquier otro caso; el motor lo comprueba, este contrato no.
 */
export const escalarEvaluacion = z
  .object({
    requestId,
    escalon: escalonEvaluacion,
    objeto: objetoDeEscalada,
    tareaId: opaqueId.optional(),
  })
  .strict();
export type EscalarEvaluacion = z.infer<typeof escalarEvaluacion>;

/** Anota lo aprendido. Sin autor: la memoria tiene que sobrevivir a que quien lo escribió rote. */
export const anotarAprendizaje = z
  .object({
    requestId,
    tipo: tipoDeAprendizaje,
    enunciado: z.string().min(MIN_LEARNING_STATEMENT_LENGTH).max(MAX_LEARNING_STATEMENT_LENGTH),
    etiquetas: z.array(etiquetaDeAprendizaje).max(MAX_LEARNING_TAGS),
  })
  .strict();
export type AnotarAprendizaje = z.infer<typeof anotarAprendizaje>;

/**
 * Ancla el resultado en el historial. **No lleva desenlace**: no hay dónde ponerlo. El motor lo
 * calcula desde los veredictos ya anotados; esta petición sólo dice «contá lo que hay».
 */
export const publicarResultado = z.object({ requestId }).strict();
export type PublicarResultado = z.infer<typeof publicarResultado>;

/**
 * Cierra: mantener, enmendar, derogar o escalar (ADR-0033). `proximaRevisionEn` es obligatoria al
 * mantener —la inercia no renueva sola— y el motor rechaza mantener un desenlace `fallido`.
 */
export const cerrarEvaluacion = z
  .object({
    requestId,
    disposicion: disposicionAcuerdo,
    proximaRevisionEn: instantMs.optional(),
  })
  .strict();
export type CerrarEvaluacion = z.infer<typeof cerrarEvaluacion>;

/**
 * «¿Esto ya se intentó?». Cada filtro es de un solo valor: la unión de varias etiquetas a la vez
 * queda para cuando haga falta. Todos son opcionales; sin ninguno, trae la memoria entera.
 */
export const consultaDeAprendizajes = z
  .object({
    etiqueta: etiquetaDeAprendizaje.optional(),
    tipo: tipoDeAprendizaje.optional(),
    desenlace: desenlaceEvaluacion.optional(),
    circuloId: opaqueId.optional(),
    decisionId: opaqueId.optional(),
  })
  .strict();
export type ConsultaDeAprendizajes = z.infer<typeof consultaDeAprendizajes>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lo que se enseña
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const criterioDeEvaluacion = z.object({
  indice: z.number().int().nonnegative(),
  descripcion: z.string(),
  fuenteDeVerificacion: z.string(),
  /** Ausente = todavía nadie lo miró. No es lo mismo que `sin-evidencia`, que es un veredicto. */
  veredicto: veredictoCriterio.optional(),
  hechoQueLoSostieneId: opaqueId.optional(),
});
export type CriterioDeEvaluacion = z.infer<typeof criterioDeEvaluacion>;

export const aprendizaje = z.object({
  id: opaqueId,
  tipo: tipoDeAprendizaje,
  enunciado: z.string(),
  etiquetas: z.array(etiquetaDeAprendizaje),
  en: instantMs,
});
export type Aprendizaje = z.infer<typeof aprendizaje>;

export const escaladaDeEvaluacion = z.object({
  id: opaqueId,
  indiceDeCriterio: z.number().int().nonnegative(),
  escalon: escalonEvaluacion,
  objeto: objetoDeEscalada,
  tareaId: opaqueId.optional(),
  en: instantMs,
  /** `false` cuando pasaron los dos semestres de prescripción del ADR-0040. */
  vigente: z.boolean(),
});
export type EscaladaDeEvaluacion = z.infer<typeof escaladaDeEvaluacion>;

/**
 * Lo publicado no corresponde a los hechos anotados (ADR-0026). Se **declara**, nunca se oculta:
 * mientras exista, el acuerdo no se puede cerrar.
 */
export const discrepanciaDeEvaluacion = z.object({
  motivo: z.enum(['resultado-no-coincide', 'huella-no-coincide']),
  publicado: desenlaceEvaluacion,
  recalculado: desenlaceEvaluacion,
  explicacion: z.string(),
});
export type DiscrepanciaDeEvaluacion = z.infer<typeof discrepanciaDeEvaluacion>;

/** `numerador`/`denominador` como enteros: nada de coma flotante en un resultado exacto (ADR-0027). */
export const proporcionDeCriterios = z.object({
  numerador: z.number().int().nonnegative(),
  denominador: z.number().int().positive(),
});
export type ProporcionDeCriterios = z.infer<typeof proporcionDeCriterios>;

/**
 * El informe completo. `desenlace` es siempre el recontado en el momento de leer; `desenlacePublicado`
 * es lo que quedó anclado en el historial la última vez que alguien publicó, y puede faltar o no
 * coincidir con `desenlace` — y si no coincide, `discrepancia` lo explica.
 *
 * No hay ningún campo por persona: ni quién abrió la revisión, ni quién valoró cada criterio, ni
 * quién escribió cada aprendizaje (ADR-0040).
 */
export const informeDeEvaluacion = z.object({
  evaluacionId: opaqueId,
  iniciativaId: opaqueId,
  huellaDelPlan: z.string(),
  estado: estadoDeEvaluacion,
  revisarEn: instantMs,
  desenlace: desenlaceEvaluacion,
  desenlacePublicado: desenlaceEvaluacion.optional(),
  discrepancia: discrepanciaDeEvaluacion.optional(),
  criterios: z.array(criterioDeEvaluacion),
  proporcionCumplida: proporcionDeCriterios.optional(),
  aprendizajes: z.array(aprendizaje),
  escaladas: z.array(escaladaDeEvaluacion),
  disposicion: disposicionAcuerdo.optional(),
  /** Frase en castellano llano, lista para pantalla (ADR-0041): qué pasó y, si aplica, qué no cuadra. */
  narrativa: z.string(),
});
export type InformeDeEvaluacion = z.infer<typeof informeDeEvaluacion>;

/**
 * Una fila de la memoria institucional: qué se decidió, qué se hizo, cómo salió y qué se aprendió.
 * Sin autor: la rotación del 20 % anual del colectivo no se lleva la memoria con ella.
 */
export const entradaDeMemoria = z.object({
  evaluacionId: opaqueId,
  iniciativaId: opaqueId,
  decisionId: opaqueId,
  propuestaId: opaqueId,
  circuloId: opaqueId,
  desenlace: desenlaceEvaluacion,
  disposicion: disposicionAcuerdo.optional(),
  aprendizaje,
});
export type EntradaDeMemoria = z.infer<typeof entradaDeMemoria>;

export const memoriaDeAprendizajes = z.array(entradaDeMemoria);
export type MemoriaDeAprendizajes = z.infer<typeof memoriaDeAprendizajes>;
