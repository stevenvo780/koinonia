/**
 * El grafo de dependencias de UN PLAN de iniciativa — y por qué un ciclo lo hace imposible.
 *
 * ═══ Qué es esto y qué NO es ═══
 *
 * `workspace/initiative.ts` ya impide ciclos en el grafo VIVO de tareas ya ofrecidas
 * (`TaskOffered.dependsOn`, guardado con `assertAcyclic` en ese mismo fichero): ese es el grafo que
 * el ledger recuerda evento a evento, tarea por tarea, y no es de este módulo — no toca ese fichero
 * porque no es propiedad de este encargo.
 *
 * Este módulo cubre lo otro que PRODUCT.md §6 promete y que el ledger todavía no puede validar de
 * una sola vez: «planificar la iniciativa en tareas con fechas y dependencias, **como borrador**»
 * (PRODUCT.md §5, uso 9 del asistente). Un borrador no tiene `TaskId` reales todavía —nadie ofreció
 * nada— así que necesita su propia estructura, más liviana: una lista de nodos con una etiqueta de
 * texto y qué otras etiquetas de la MISMA lista debe esperar. `validarPlanDeDependencias` es la
 * comprobación completa que ese borrador tiene que pasar antes de convertirse en hitos y ofertas
 * reales; `assertPlanSinCiclos` es la mitad de esa comprobación, aislada, para quien sólo necesita
 * el veto de ciclo.
 *
 * ═══ Por qué un ciclo hace el plan imposible ═══
 *
 * Si A depende de B y B depende de A, ninguna de las dos puede empezar primero: no existe un orden
 * de ejecución que las satisfaga a ambas. No es una preferencia de diseño, es aritmética de grafos —
 * un plan con un ciclo no es un plan peor, es un plan que no se puede ejecutar. Por eso se RECHAZA
 * entero (`PreconditionError`), igual que el resto de este paquete falla cerrado ante una entrada que
 * no se puede honrar.
 *
 * ═══ Por qué la detección es determinista y no necesita reloj ni aleatoriedad ═══
 *
 * Es un recorrido en profundidad de tres colores (blanco/gris/negro) sobre datos ya dados: el mismo
 * grafo produce siempre el mismo veredicto, sin leer el instante actual ni ningún otro estado externo
 * (regla de pureza de `packages/domain`).
 */

import { PreconditionError } from '../errors.js';

/** Cuántos nodos admite un borrador. Un plan de más de 200 tareas no es un borrador, es otra cosa. */
export const MAX_NODOS_PLAN_DEPENDENCIAS = 200;

/**
 * Un nodo del borrador: una etiqueta de texto (no un `TaskId` — el borrador es previo a cualquier
 * oferta real) y de qué otras etiquetas de la MISMA lista depende. `dependeDe` puede estar vacío: es
 * lo normal para la mayoría de las tareas de un plan.
 */
export interface NodoDependencia {
  readonly id: string;
  readonly dependeDe: readonly string[];
}

/**
 * El defecto exacto que impide validar un borrador de dependencias, para que el llamador pueda
 * mostrar algo más útil que «el plan es inválido».
 */
export type DefectoPlanDependencias =
  | { readonly tipo: 'id-duplicado'; readonly id: string }
  | { readonly tipo: 'auto-dependencia'; readonly id: string }
  | { readonly tipo: 'dependencia-repetida'; readonly id: string; readonly dependeDe: string }
  | { readonly tipo: 'dependencia-inexistente'; readonly id: string; readonly dependeDe: string }
  | { readonly tipo: 'ciclo'; readonly ciclo: readonly string[] };

function encontrarIdDuplicado(nodos: readonly NodoDependencia[]): string | undefined {
  const vistos = new Set<string>();
  for (const nodo of nodos) {
    if (vistos.has(nodo.id)) return nodo.id;
    vistos.add(nodo.id);
  }
  return undefined;
}

/**
 * El primer ciclo encontrado en el grafo, como la secuencia de ids que lo compone (`A, B, C, A`), o
 * `undefined` si el grafo es acíclico. DFS de tres colores: blanco (no visitado, ausente de ambos
 * conjuntos), gris (`enPila`, en el camino actual) y negro (`resuelto`, ya sabemos que no cierra
 * ningún ciclo por ahí). Encontrar un nodo gris durante el recorrido ES el ciclo.
 */
function primerCiclo(nodos: readonly NodoDependencia[]): readonly string[] | undefined {
  const porId = new Map(nodos.map((nodo) => [nodo.id, nodo]));
  const enPila = new Set<string>();
  const resuelto = new Set<string>();
  const camino: string[] = [];

  const visitar = (id: string): readonly string[] | undefined => {
    if (resuelto.has(id)) return undefined;
    if (enPila.has(id)) return [...camino.slice(camino.indexOf(id)), id];

    enPila.add(id);
    camino.push(id);
    const nodo = porId.get(id);
    if (nodo !== undefined) {
      for (const dependencia of nodo.dependeDe) {
        const ciclo = visitar(dependencia);
        if (ciclo !== undefined) return ciclo;
      }
    }
    camino.pop();
    enPila.delete(id);
    resuelto.add(id);
    return undefined;
  };

  for (const nodo of nodos) {
    const ciclo = visitar(nodo.id);
    if (ciclo !== undefined) return ciclo;
  }
  return undefined;
}

/** `true` si y sólo si el grafo tiene al menos un ciclo. Pura, sin lanzar. */
export function tieneCiclo(nodos: readonly NodoDependencia[]): boolean {
  return primerCiclo(nodos) !== undefined;
}

/**
 * El primer defecto que invalida el borrador, en este orden: id duplicado, auto-dependencia,
 * dependencia repetida dentro del mismo nodo, dependencia que no existe en la lista, y por último —
 * sólo si la forma ya es correcta— un ciclo. Revisar la forma antes que el ciclo evita acusar de
 * «ciclo» a un borrador que en realidad tiene una referencia rota.
 */
export function primerDefecto(
  nodos: readonly NodoDependencia[],
): DefectoPlanDependencias | undefined {
  const duplicado = encontrarIdDuplicado(nodos);
  if (duplicado !== undefined) return { tipo: 'id-duplicado', id: duplicado };

  const idsConocidos = new Set(nodos.map((nodo) => nodo.id));
  for (const nodo of nodos) {
    if (nodo.dependeDe.includes(nodo.id)) {
      return { tipo: 'auto-dependencia', id: nodo.id };
    }
    const vistas = new Set<string>();
    for (const dependeDe of nodo.dependeDe) {
      if (vistas.has(dependeDe)) {
        return { tipo: 'dependencia-repetida', id: nodo.id, dependeDe };
      }
      vistas.add(dependeDe);
      if (!idsConocidos.has(dependeDe)) {
        return { tipo: 'dependencia-inexistente', id: nodo.id, dependeDe };
      }
    }
  }

  const ciclo = primerCiclo(nodos);
  if (ciclo !== undefined) return { tipo: 'ciclo', ciclo };

  return undefined;
}

function mensajeDefecto(defecto: DefectoPlanDependencias): { code: string; message: string } {
  switch (defecto.tipo) {
    case 'id-duplicado':
      return {
        code: 'PLAN_DEPENDENCIAS_ID_DUPLICADO',
        message: `la tarea "${defecto.id}" aparece más de una vez en el borrador`,
      };
    case 'auto-dependencia':
      return {
        code: 'PLAN_DEPENDENCIAS_AUTO_DEPENDENCIA',
        message: `la tarea "${defecto.id}" no puede depender de sí misma`,
      };
    case 'dependencia-repetida':
      return {
        code: 'PLAN_DEPENDENCIAS_REPETIDA',
        message: `la tarea "${defecto.id}" declara dos veces la misma dependencia "${defecto.dependeDe}"`,
      };
    case 'dependencia-inexistente':
      return {
        code: 'PLAN_DEPENDENCIAS_INEXISTENTE',
        message: `la tarea "${defecto.id}" depende de "${defecto.dependeDe}", que no está en el borrador`,
      };
    case 'ciclo':
      return {
        code: 'PLAN_DEPENDENCIAS_CICLO',
        message: `el plan es imposible: ${defecto.ciclo.join(' → ')} forma un ciclo`,
      };
  }
}

/**
 * Valida el borrador completo: cuenta de nodos dentro del límite, sin ids duplicados, sin
 * auto-dependencias, sin dependencias repetidas o que apunten fuera del borrador y, por último, sin
 * ciclos. Lanza `PreconditionError` con el primer defecto que encuentra; no acumula una lista porque
 * corregir el primero puede cambiar o resolver los siguientes.
 */
export function validarPlanDeDependencias(nodos: readonly NodoDependencia[]): void {
  if (nodos.length > MAX_NODOS_PLAN_DEPENDENCIAS) {
    throw new PreconditionError(
      'PLAN_DEPENDENCIAS_DEMASIADOS_NODOS',
      `un borrador admite como máximo ${String(MAX_NODOS_PLAN_DEPENDENCIAS)} tareas`,
    );
  }
  const defecto = primerDefecto(nodos);
  if (defecto !== undefined) {
    const { code, message } = mensajeDefecto(defecto);
    throw new PreconditionError(code, message);
  }
}

/** Sólo el veto de ciclo, para quien ya validó la forma por otro lado (p. ej. una prueba dirigida). */
export function assertPlanSinCiclos(nodos: readonly NodoDependencia[]): void {
  const ciclo = primerCiclo(nodos);
  if (ciclo !== undefined) {
    throw new PreconditionError(
      'PLAN_DEPENDENCIAS_CICLO',
      `el plan es imposible: ${ciclo.join(' → ')} forma un ciclo`,
    );
  }
}
