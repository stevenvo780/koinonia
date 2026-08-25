/**
 * El hecho de que una tarea quedó desbloqueada porque todas sus dependencias completaron
 * (PRODUCT.md §6: «el sistema avisa a quien tiene la tarea B cuando la A se destraba»).
 *
 * Lo que estas pruebas atacan, en orden de importancia:
 *
 *  1. que una tarea SIN dependencias nunca aparezca (nunca estuvo esperando a nadie);
 *  2. que una tarea con dependencias sólo aparezca cuando TODAS completaron, nunca con una sola;
 *  3. que el instante y la dependencia que se reportan sean los de la ÚLTIMA en completar, no la
 *     primera ni cualquiera de las que ya estaban listas antes;
 *  4. que el cálculo sea puro y recalculable: el mismo conjunto de entrada produce siempre la misma
 *     salida, sin importar el orden de la lista.
 */

import { describe, expect, it } from 'vitest';

import {
  destrabeDeTarea,
  destrabesDeConjunto,
  type TareaParaDestrabe,
} from '../src/execution/destrabe-de-dependencia.js';
import { instant, taskId } from '../src/ids.js';

const A = taskId('a'.repeat(32));
const B = taskId('b'.repeat(32));
const C = taskId('c'.repeat(32));

const T1 = instant(1_000);
const T2 = instant(2_000);
const T3 = instant(3_000);

describe('destrabesDeConjunto — sin dependencias, nunca hay destrabe', () => {
  it('una tarea sin dependsOn no aparece, complete o no', () => {
    const sinDeps: TareaParaDestrabe = { taskId: A, dependsOn: [], completedAt: undefined };
    expect(destrabesDeConjunto([sinDeps])).toEqual([]);
  });

  it('tampoco aparece si además ya está completada ella misma', () => {
    const sinDeps: TareaParaDestrabe = { taskId: A, dependsOn: [], completedAt: T1 };
    expect(destrabesDeConjunto([sinDeps])).toEqual([]);
  });
});

describe('destrabesDeConjunto — una sola dependencia', () => {
  it('no aparece mientras la dependencia sigue sin completar', () => {
    const dependiente: TareaParaDestrabe = { taskId: B, dependsOn: [A], completedAt: undefined };
    const dependencia: TareaParaDestrabe = { taskId: A, dependsOn: [], completedAt: undefined };
    expect(destrabesDeConjunto([dependiente, dependencia])).toEqual([]);
  });

  it('aparece en cuanto la única dependencia completa, con su id y su instante exactos', () => {
    const dependiente: TareaParaDestrabe = { taskId: B, dependsOn: [A], completedAt: undefined };
    const dependencia: TareaParaDestrabe = { taskId: A, dependsOn: [], completedAt: T1 };
    expect(destrabesDeConjunto([dependiente, dependencia])).toEqual([
      { taskId: B, dependenciaCompletadaId: A, destrabadaEn: T1 },
    ]);
  });

  it('si la propia dependencia no está en el conjunto, no se puede afirmar el destrabe', () => {
    const dependiente: TareaParaDestrabe = { taskId: B, dependsOn: [A], completedAt: undefined };
    expect(destrabesDeConjunto([dependiente])).toEqual([]);
  });
});

describe('destrabesDeConjunto — varias dependencias: manda la ÚLTIMA en completar', () => {
  it('no aparece si falta aunque sea una de las dos', () => {
    const dependiente: TareaParaDestrabe = { taskId: C, dependsOn: [A, B], completedAt: undefined };
    const a: TareaParaDestrabe = { taskId: A, dependsOn: [], completedAt: T1 };
    const b: TareaParaDestrabe = { taskId: B, dependsOn: [], completedAt: undefined };
    expect(destrabesDeConjunto([dependiente, a, b])).toEqual([]);
  });

  it('cuando ambas completan, el instante y el id que se reportan son los de la que completó última', () => {
    const dependiente: TareaParaDestrabe = { taskId: C, dependsOn: [A, B], completedAt: undefined };
    const a: TareaParaDestrabe = { taskId: A, dependsOn: [], completedAt: T1 };
    const b: TareaParaDestrabe = { taskId: B, dependsOn: [], completedAt: T3 };
    expect(destrabesDeConjunto([dependiente, a, b])).toEqual([
      { taskId: C, dependenciaCompletadaId: B, destrabadaEn: T3 },
    ]);
  });

  it('el orden de la lista de entrada no cambia el resultado', () => {
    const dependiente: TareaParaDestrabe = { taskId: C, dependsOn: [A, B], completedAt: undefined };
    const a: TareaParaDestrabe = { taskId: A, dependsOn: [], completedAt: T2 };
    const b: TareaParaDestrabe = { taskId: B, dependsOn: [], completedAt: T1 };
    const resultadoUnOrden = destrabesDeConjunto([dependiente, a, b]);
    const resultadoOtroOrden = destrabesDeConjunto([b, dependiente, a]);
    expect(resultadoUnOrden).toEqual(resultadoOtroOrden);
    expect(resultadoUnOrden).toEqual([{ taskId: C, dependenciaCompletadaId: A, destrabadaEn: T2 }]);
  });
});

describe('destrabesDeConjunto — varias tareas destrabadas a la vez, cada una con su propio hecho', () => {
  it('reporta un hecho por cada tarea que se destrabó, sin mezclarlos', () => {
    const a: TareaParaDestrabe = { taskId: A, dependsOn: [], completedAt: T1 };
    const b: TareaParaDestrabe = { taskId: B, dependsOn: [A], completedAt: undefined };
    const c: TareaParaDestrabe = { taskId: C, dependsOn: [A], completedAt: undefined };
    const hechos = destrabesDeConjunto([a, b, c]);
    expect(hechos).toHaveLength(2);
    expect(hechos.find((h) => h.taskId === B)).toEqual({
      taskId: B,
      dependenciaCompletadaId: A,
      destrabadaEn: T1,
    });
    expect(hechos.find((h) => h.taskId === C)).toEqual({
      taskId: C,
      dependenciaCompletadaId: A,
      destrabadaEn: T1,
    });
  });
});

describe('destrabeDeTarea — el atajo de una sola tarea', () => {
  it('coincide con lo que destrabesDeConjunto produciría para esa tarea', () => {
    const dependiente: TareaParaDestrabe = { taskId: B, dependsOn: [A], completedAt: undefined };
    const dependencia: TareaParaDestrabe = { taskId: A, dependsOn: [], completedAt: T1 };
    expect(destrabeDeTarea(dependiente, [dependencia])).toEqual({
      taskId: B,
      dependenciaCompletadaId: A,
      destrabadaEn: T1,
    });
  });

  it('undefined cuando todavía no se destrabó', () => {
    const dependiente: TareaParaDestrabe = { taskId: B, dependsOn: [A], completedAt: undefined };
    const dependencia: TareaParaDestrabe = { taskId: A, dependsOn: [], completedAt: undefined };
    expect(destrabeDeTarea(dependiente, [dependencia])).toBeUndefined();
  });

  it('undefined cuando la tarea no tiene dependencias', () => {
    const sinDeps: TareaParaDestrabe = { taskId: A, dependsOn: [], completedAt: undefined };
    expect(destrabeDeTarea(sinDeps, [])).toBeUndefined();
  });
});
