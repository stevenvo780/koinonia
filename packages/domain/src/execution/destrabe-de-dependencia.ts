/**
 * El hecho de que una tarea quedó desbloqueada porque todas sus dependencias llegaron a
 * `completada` (PRODUCT.md §6: «las dependencias son explícitas y el sistema avisa a quien tiene la
 * tarea B cuando la A se destraba»).
 *
 * ═══ Por qué esto NO es un sistema de notificaciones ═══
 *
 * La auditoría que originó este encargo es explícita: «no hay sistema de notificaciones en todo el
 * proyecto». Construir uno —colas, entrega, lectura, canal— sería inventar una pieza entera fuera
 * del alcance de un paquete de dominio puro, y probablemente del proyecto entero en este momento.
 * Lo que SÍ es dominio puro, y lo que de verdad falta, es el HECHO en sí: cuándo una tarea concreta
 * pasó de «esperando» a «lista para empezar», y cuál fue la dependencia que lo causó. Con ese hecho
 * calculado de forma determinista, una notificación futura —el mecanismo que sea— tiene algo fiable
 * que leer en vez de inferirlo con una consulta ad-hoc cada vez. Este módulo entrega exactamente
 * eso y nada más.
 *
 * ═══ Por qué es puro y determinista ═══
 *
 * `destrabesDeConjunto` no lee ningún reloj: el instante de cada destrabe es el máximo de los
 * `completedAt` ya conocidos de las dependencias, un dato que ya vive en `InitiativeTask` (
 * `workspace/initiative.ts`, fuera de mi ámbito de escritura, pero de lectura libre: `completedAt`
 * se fija en el momento de `TaskReviewAccepted`, ver ese fichero). El mismo conjunto de tareas
 * produce siempre el mismo resultado — recalculable en cualquier instante posterior, sin perder
 * nada, que es la propiedad que hace que este cálculo sea seguro de repetir tantas veces como una
 * futura capa de notificaciones necesite sin duplicar ni perder un aviso.
 *
 * ═══ Por qué toma una forma reducida y no `InitiativeTask` completa ═══
 *
 * Igual que `EntradaEscalonDeTarea` en `escalones.ts`: quien llama ya tiene el agregado completo y
 * sólo necesita pasar los tres campos que la regla usa. Reducir la entrada documenta exactamente de
 * qué depende el cálculo (nada de estado, ni ofertas, ni evidencia) y hace la función trivial de
 * probar sin construir una `InitiativeTask` entera en cada caso.
 */

import { instant as toInstant, type Instant, type TaskId } from '../ids.js';

/**
 * Lo mínimo de una tarea para calcular si ella misma se destrabó o si destrabó a otras: su id, de
 * qué depende y, si ya cerró, cuándo. `completedAt` es `undefined` para cualquier tarea que no llegó
 * todavía a `completada` (incluida la propia tarea sobre la que se pregunta: no hace falta que haya
 * cerrado para participar como dependencia de otra).
 */
export interface TareaParaDestrabe {
  readonly taskId: TaskId;
  readonly dependsOn: readonly TaskId[];
  readonly completedAt: Instant | undefined;
}

/**
 * El hecho: la tarea `taskId` quedó desbloqueada en `destrabadaEn`, porque `dependenciaCompletadaId`
 * fue la última de sus dependencias en llegar a `completada`. Si dos dependencias completaron en el
 * mismo instante exacto, cualquiera de las dos es una respuesta válida — el instante es lo que
 * importa para el aviso, no cuál de los dos ids empatados se cita.
 */
export interface DestrabeDeDependencia {
  readonly taskId: TaskId;
  readonly dependenciaCompletadaId: TaskId;
  readonly destrabadaEn: Instant;
}

/**
 * Todas las tareas del conjunto que, a la luz de los `completedAt` ya conocidos, tienen TODAS sus
 * dependencias completadas — el hecho «B se destrabó» para cada una. Una tarea sin dependencias
 * nunca aparece aquí: nunca estuvo esperando a nadie, así que no hay destrabe que señalar (no es lo
 * mismo que «siempre estuvo lista»: es que la pregunta no aplica).
 *
 * No filtra por el propio estado de la tarea destrabada (podría ya estar `completada` ella misma,
 * por ejemplo si sus dependencias cerraron después por un reordenamiento administrativo raro): el
 * hecho de dependencia es válido igual, y es quien llama —con el estado real delante— quien decide
 * si todavía vale la pena avisar. Mantenerlo así conserva la función pura y recalculable sin que
 * dependa de un campo (`status`) que esta interfaz reducida ni siquiera pide.
 */
export function destrabesDeConjunto(
  tareas: readonly TareaParaDestrabe[],
): readonly DestrabeDeDependencia[] {
  const completadaEnPorId = new Map<TaskId, Instant>();
  for (const tarea of tareas) {
    if (tarea.completedAt !== undefined) {
      toInstant(tarea.completedAt);
      completadaEnPorId.set(tarea.taskId, tarea.completedAt);
    }
  }

  const resultado: DestrabeDeDependencia[] = [];
  for (const tarea of tareas) {
    if (tarea.dependsOn.length === 0) continue;

    let maxInstant: Instant | undefined;
    let disparadora: TaskId | undefined;
    let todasCompletas = true;

    for (const dependenciaId of tarea.dependsOn) {
      const completedAt = completadaEnPorId.get(dependenciaId);
      if (completedAt === undefined) {
        todasCompletas = false;
        break;
      }
      if (maxInstant === undefined || completedAt > maxInstant) {
        maxInstant = completedAt;
        disparadora = dependenciaId;
      }
    }

    if (todasCompletas && maxInstant !== undefined && disparadora !== undefined) {
      resultado.push({
        taskId: tarea.taskId,
        dependenciaCompletadaId: disparadora,
        destrabadaEn: maxInstant,
      });
    }
  }
  return resultado;
}

/**
 * Sólo el hecho de UNA tarea, para quien ya sabe cuál le interesa y no quiere recorrer el conjunto
 * entero buscándola. `undefined` si no tiene dependencias o si todavía falta al menos una por
 * completar.
 */
export function destrabeDeTarea(
  tarea: TareaParaDestrabe,
  dependencias: readonly TareaParaDestrabe[],
): DestrabeDeDependencia | undefined {
  const hechos = destrabesDeConjunto([tarea, ...dependencias]);
  return hechos.find((hecho) => hecho.taskId === tarea.taskId);
}
