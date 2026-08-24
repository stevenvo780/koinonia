/**
 * Lo que el plan de una iniciativa compromete, resumido — y la ventana de impugnación que separa
 * «la decisión se aprobó» de «se puede empezar a trabajar».
 *
 * Puro y sin JSX por el mismo motivo que `escalones.ts`: es la parte que se puede comprobar con el
 * `vitest` que ya existe, sin añadir ninguna dependencia (regla 4).
 *
 * ═══ Los campos del plan: los que hay y los que NO hay ═══
 *
 * El pliego enumera trece campos para una iniciativa. Contra el código, hoy existen estos y sólo
 * estos, y este fichero los lee de donde de verdad están:
 *
 *  · **objetivo, responsable, fecha de evaluación, criterios** — `ExecutionPlan`
 *    (`packages/domain/src/workspace/execution-plan.ts`), ya pintados en el detalle desde antes.
 *  · **hitos** y **tareas** — `InitiativeState.milestones` / `.tasks`.
 *  · **esfuerzo** — `InitiativeTask.effortMinutes`, por tarea. El total de la iniciativa no existía
 *    en ninguna parte: lo suma `resumirPlan`.
 *  · **dependencias** — `InitiativeTask.dependsOn`. Estaban dichas dentro de cada tarea; lo que
 *    faltaba era poder ver el orden del trabajo de un vistazo, que es `ordenDelTrabajo`.
 *  · **evidencias** — `InitiativeTask.evidence`, por tarea; acá se cuentan para toda la iniciativa.
 *  · **resultado final** — no es un campo del plan: es el desenlace que calcula la evaluación
 *    (ADR-0053) y que ya pinta `[id]/evaluacion.tsx`. No se duplica acá.
 *
 * **Recursos que hacen falta, riesgos y presupuesto NO EXISTEN.** No están en `ExecutionPlan`, ni en
 * `InitiativeState`, ni en `packages/contracts/src/http.ts`, ni hay ninguna ruta que los escriba
 * (comprobado por búsqueda exhaustiva de `presupuesto|budget|recursos|riesgos|risks` en
 * todo `packages` y `services/api/src`: cero resultados fuera de comentarios ajenos al tema). Por
 * eso esta pantalla **no los pinta**, ni siquiera vacíos: el propio encargo lo pide con esas
 * palabras para el presupuesto —«que no aparezca si no aplica, no un cero»— y la regla vale igual
 * para los otros dos. Un campo «Presupuesto: —» sería una fachada: prometería que el sistema guarda
 * algo que nadie puede guardar. Cuando el dominio los tenga, se suman a `ResumenDelPlan` y a
 * `<PlanComprometido>`; mientras tanto, la ausencia es el dato honesto.
 */

import type { Hito, Tarea } from '@koinonia/contracts';

const MINUTOS_POR_HORA = 60;
const MS_POR_HORA = 60 * 60 * 1000;

/**
 * El plan visto como un todo. Cada cifra describe **la iniciativa**, nunca a una persona: es la
 * misma distinción que separa «este documento tiene 40 páginas» de «fulano escribió 12» —ADR-0039
 * prohíbe lo segundo, y ninguna de estas cifras se puede desagregar por quien lleva la tarea.
 */
export interface ResumenDelPlan {
  readonly hitos: number;
  readonly tareas: number;
  /** Suma del tiempo estimado de TODAS las tareas del plan, incluidas las que volvieron al círculo:
   *  el trabajo sigue haciendo falta aunque la oferta cambie de manos. */
  readonly esfuerzoMinutos: number;
  /** Cuántas tareas no pueden empezar hasta que otra termine. */
  readonly tareasQueEsperan: number;
  /** Cuántos datos de respaldo se han aportado en toda la iniciativa. */
  readonly evidencias: number;
}

export function resumirPlan(iniciativa: {
  readonly hitos: readonly Hito[];
  readonly tareas: readonly Tarea[];
}): ResumenDelPlan {
  let esfuerzoMinutos = 0;
  let tareasQueEsperan = 0;
  let evidencias = 0;
  for (const tarea of iniciativa.tareas) {
    esfuerzoMinutos += tarea.esfuerzoMinutos;
    if (tarea.dependeDe.length > 0) tareasQueEsperan += 1;
    evidencias += tarea.evidencias.length;
  }
  return {
    hitos: iniciativa.hitos.length,
    tareas: iniciativa.tareas.length,
    esfuerzoMinutos,
    tareasQueEsperan,
    evidencias,
  };
}

/**
 * Minutos dichos como los diría una persona. Una iniciativa entera puede sumar miles de minutos, y
 * «4 380 minutos» no le dice nada a nadie: por encima de una hora se pasa a horas, y los minutos
 * sueltos sólo se dicen si los hay.
 */
export function duracionEnPalabras(minutos: number): string {
  if (minutos < MINUTOS_POR_HORA) {
    return minutos === 1 ? '1 minuto' : `${String(minutos)} minutos`;
  }
  const horas = Math.floor(minutos / MINUTOS_POR_HORA);
  const resto = minutos % MINUTOS_POR_HORA;
  const enHoras = horas === 1 ? '1 hora' : `${String(horas)} horas`;
  if (resto === 0) return enHoras;
  return `${enHoras} y ${resto === 1 ? '1 minuto' : `${String(resto)} minutos`}`;
}

/** Una tarea y lo que tiene que terminar antes que ella. */
export interface EsperaDeTarea {
  readonly id: string;
  readonly titulo: string;
  readonly espera: readonly { readonly titulo: string; readonly completada: boolean }[];
  /** `true` si todo lo que espera ya está completo: puede arrancar cuando alguien la tome. */
  readonly libre: boolean;
}

/**
 * El orden del trabajo: qué tarea espera a cuál. Sólo devuelve las tareas que dependen de algo —una
 * lista con todas sería el listado de tareas otra vez, no el orden— y resuelve los identificadores
 * a títulos, porque un identificador opaco en pantalla no es información para nadie.
 *
 * Una dependencia que apunte a una tarea que ya no está en la lista se dice «una tarea anterior» y
 * se cuenta como pendiente: prometer que está completa sin poder mirarla sería peor que decir que
 * no se sabe.
 */
export function ordenDelTrabajo(tareas: readonly Tarea[]): readonly EsperaDeTarea[] {
  const porId = new Map(tareas.map((tarea) => [tarea.id, tarea] as const));
  const salida: EsperaDeTarea[] = [];
  for (const tarea of tareas) {
    if (tarea.dependeDe.length === 0) continue;
    const espera = tarea.dependeDe.map((dependencia) => {
      const encontrada = porId.get(dependencia);
      return {
        titulo: encontrada?.titulo ?? 'Una tarea anterior',
        completada: encontrada?.estado === 'completada',
      };
    });
    salida.push({
      id: tarea.id,
      titulo: tarea.titulo,
      espera,
      libre: espera.every((paso) => paso.completada),
    });
  }
  return salida;
}

/**
 * La ventana de impugnación de una iniciativa recién nacida (ADR-0043/ADR-0044).
 *
 * `horas` **se deriva** de los dos instantes que manda el servidor; no está escrito «72» en ninguna
 * parte de esta pantalla. `DEFAULT_CHALLENGE_WINDOW_MS` es hoy 72 h, pero es configuración del
 * motor, y una pantalla que anunciara un número fijo mentiría el día que el Instituto lo cambie.
 */
export interface VentanaDeImpugnacion {
  readonly nacioEn: number;
  readonly ratificableEn: number;
  readonly horas: number;
  readonly vencida: boolean;
}

export function ventanaDeImpugnacion(
  creadaEn: number,
  ratificableEn: number | undefined,
  ahora: number,
): VentanaDeImpugnacion | undefined {
  if (ratificableEn === undefined) return undefined;
  return {
    nacioEn: creadaEn,
    ratificableEn,
    horas: Math.max(0, Math.round((ratificableEn - creadaEn) / MS_POR_HORA)),
    vencida: ahora >= ratificableEn,
  };
}
