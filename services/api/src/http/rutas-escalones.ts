/**
 * `GET /iniciativas/:id/escalones`: los peldaños del flujo de incumplimiento (ADR-0040) de cada
 * tarea VIVA de una iniciativa, con su visibilidad correcta — nunca «cuántas tareas atrasó fulano».
 *
 * `packages/domain/src/execution/escalones.ts` calcula el peldaño puro de UNA tarea; este fichero
 * hace tres cosas que sí exigen I/O y por eso no pueden vivir en el dominio: leer el estado real de
 * la iniciativa, contar cuántas veces volvió cada tarea al círculo (`ofertas.length - 1`, el propio
 * historial de la tarea) y detectar el patrón del círculo que el pliego pide para el peldaño 6
 * («tras 3 reasignaciones, **o patrón en el círculo**») recorriendo TODAS las iniciativas del mismo
 * círculo — algo que ningún agregado de dominio puede hacer por sí mismo sin dejar de ser puro.
 *
 * ═══ Por qué la visibilidad se decide aquí y no en el dominio ═══
 *
 * PRODUCT.md §6 no da los mismos ojos a los siete peldaños: `por-vencer` y `consultada` son
 * «recordatorio privado» y «sólo la persona» — nadie más los ve, ni el propio círculo. Los demás
 * (`atrasada`, `bloqueada`, `en-apoyo`, `reasignada`, `en-revision-colectiva`) marcan la TAREA, y el
 * círculo entero puede mirarlos sin que eso identifique una conducta de nadie: son estados que
 * `workspace/initiative.ts` ya expone sin restricción (`TaskBlocked`/`TaskHelpRequested` no llevan
 * ningún permiso especial de lectura). `access.ts` no tiene un rol «enlace del círculo» todavía —
 * la fila 1 de la tabla del pliego lo nombra, pero no existe en el vocabulario cerrado de `Role`
 * (fuera de mi ámbito ampliarlo) — así que `atrasada` se trata aquí con la misma regla que los
 * peldaños abiertos al círculo: sigue siendo estrictamente menos expuesto que inventar un rol nuevo
 * sin que nadie lo pidiera.
 *
 * Ni una función de este fichero devuelve, agrega ni ordena nada por persona: la respuesta es una
 * lista de `{ tareaId, escalon }`, nunca `{ miembroId, cuantasVecesAtrasoTareas }` — eso es
 * exactamente el «ranking humillante» que el pliego prohíbe y ADR-0040 hace estructuralmente
 * imposible de construir con lo que este módulo expone.
 *
 * ═══ Nota de integración ═══
 *
 * Este fichero es nuevo y `services/api/src/http/app.ts` todavía no llama a
 * `registrarRutasDeEscalones` (agente integrador posterior, igual que `rutas-iniciativas.ts` y
 * `rutas-evaluacion.ts`). Sí depende de `./service.js` — a diferencia de `rutas-evaluacion.ts`, que
 * en su momento tuvo que evitarlo, `verIniciativa`/`listarIniciativas`/`ServicioDeps` ya existen y
 * son de sólo lectura, así que reutilizarlos no exige tocar ningún fichero fuera de mi ámbito.
 * `packages/domain/src/index.ts` sí necesitó una línea nueva (`export * from
 * './execution/escalones.js';`) para que este fichero pudiera importar el cálculo puro por
 * `@koinonia/domain` como el resto de las rutas — sin ella, ninguna prueba de este archivo podría
 * siquiera cargar el módulo.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  calcularEscalonDeTarea,
  type EscalonTarea,
  instant,
  type Instant,
  type InitiativeState,
  type InitiativeTask,
} from '@koinonia/domain';

import { resolveSession } from './identity.js';
import type { AuthenticatedMember } from './ports.js';
import {
  listarIniciativas,
  ServicioError,
  verIniciativa,
  type IniciativaConId,
  type ServicioDeps,
} from './service.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ContextoEscalones {
  readonly deps: ServicioDeps;
}

/**
 * Cuántas tareas del MISMO círculo, contando todas sus iniciativas, tienen que estar en dificultad
 * a la vez para que se considere «patrón en el círculo» (PRODUCT.md §6, fila 6, segunda cláusula).
 * Comparte el número con `UMBRAL_REASIGNACIONES_PARA_REVISION_COLECTIVA` del dominio porque las dos
 * cláusulas del pliego («3 reasignaciones, O patrón») describen la misma severidad por dos caminos
 * distintos, no una escala diferente para cada una.
 */
const UMBRAL_PATRON_DE_CIRCULO = 3;

/**
 * Los estados de tarea que cuentan como «en dificultad» para el patrón del círculo. Deliberadamente
 * NO usa `calcularEscalonDeTarea` para decidirlo: si lo hiciera, el peldaño de una tarea dependería
 * del patrón, y el patrón de otras tareas dependería de sus propios peldaños — una referencia
 * circular. Comparar sólo el `status`, que no depende de `ahora` ni del patrón, la rompe.
 */
const ESTADOS_EN_DIFICULTAD: ReadonlySet<InitiativeTask['status']> = new Set([
  'bloqueada',
  'en-apoyo',
  'rechazada',
  'reasignacion-solicitada',
]);

/** Peldaños que sólo puede ver quien asumió la tarea: «recordatorio privado», «sólo la persona». */
const PELDANOS_PRIVADOS: ReadonlySet<EscalonTarea> = new Set(['por-vencer', 'consultada']);

async function quienLlama(
  ctx: ContextoEscalones,
  request: FastifyRequest,
): Promise<AuthenticatedMember | undefined> {
  const cabecera = request.headers.authorization;
  const token = cabecera?.startsWith('Bearer ') === true ? cabecera.slice(7) : undefined;
  if (token === undefined || token === '') return undefined;
  const client = await ctx.deps.pool.connect();
  try {
    return await resolveSession(client, token, ctx.deps.ports.clock);
  } finally {
    client.release();
  }
}

/** `TaskOffered` cuenta como la primera oferta; cada `TaskReoffered` posterior es un regreso más. */
function reasignacionesDe(task: InitiativeTask): number {
  return Math.max(0, task.offers.length - 1);
}

/**
 * Cuántas tareas del círculo de `objetivo` están hoy «en dificultad», sin contar `objetivo` misma
 * (una tarea no es su propio patrón). Recorre TODAS las iniciativas del círculo porque el patrón que
 * el pliego describe es del círculo, no de una sola iniciativa.
 */
async function contarDificultadEnElCirculo(
  deps: ServicioDeps,
  circleId: InitiativeState['circleId'],
  objetivo: InitiativeTask['taskId'],
): Promise<number> {
  const iniciativas = await listarIniciativas(deps);
  let total = 0;
  for (const { state } of iniciativas) {
    if (state.circleId !== circleId) continue;
    for (const task of state.tasks) {
      if (task.taskId === objetivo) continue;
      if (ESTADOS_EN_DIFICULTAD.has(task.status)) total += 1;
    }
  }
  return total;
}

/** `true` si `quien` es la persona que tiene la tarea asignada (o, sin aceptar todavía, la ofrecida). */
function esQuienTieneLaTarea(
  quien: AuthenticatedMember | undefined,
  task: InitiativeTask,
): boolean {
  if (quien === undefined) return false;
  return quien.memberId === task.assigneeId || quien.memberId === task.offeredTo;
}

/** `true` si `quien` pertenece al círculo de la iniciativa (lo que el pliego llama simplemente «el círculo»). */
function esDelCirculo(
  quien: AuthenticatedMember | undefined,
  circleId: InitiativeState['circleId'],
): boolean {
  if (quien === undefined) return false;
  return quien.circles.includes(circleId);
}

/**
 * Aplica la visibilidad del pliego a un peldaño ya calculado: `undefined` si no hay nada que
 * mostrar, o si quien pregunta no tiene ojos para verlo.
 */
function segunQuienMira(
  escalon: EscalonTarea | undefined,
  quien: AuthenticatedMember | undefined,
  task: InitiativeTask,
  circleId: InitiativeState['circleId'],
): EscalonTarea | undefined {
  if (escalon === undefined) return undefined;
  if (PELDANOS_PRIVADOS.has(escalon)) {
    return esQuienTieneLaTarea(quien, task) ? escalon : undefined;
  }
  return esQuienTieneLaTarea(quien, task) || esDelCirculo(quien, circleId) ? escalon : undefined;
}

export interface EscalonDeTarea {
  readonly tareaId: string;
  readonly escalon: EscalonTarea | null;
}

export interface EscalonesDeIniciativa {
  readonly tareas: readonly EscalonDeTarea[];
}

async function calcularEscalonesVisibles(
  ctx: ContextoEscalones,
  iniciativa: IniciativaConId,
  quien: AuthenticatedMember | undefined,
  ahora: Instant,
): Promise<EscalonesDeIniciativa> {
  const { state } = iniciativa;
  const tareas: EscalonDeTarea[] = [];
  for (const task of state.tasks) {
    const reasignaciones = reasignacionesDe(task);
    const enDificultadFuera = await contarDificultadEnElCirculo(
      ctx.deps,
      state.circleId,
      task.taskId,
    );
    const patronEnElCirculo = enDificultadFuera >= UMBRAL_PATRON_DE_CIRCULO;
    const escalon = calcularEscalonDeTarea(
      { status: task.status, dueAt: task.dueAt, reasignaciones, patronEnElCirculo },
      ahora,
    );
    const visible = segunQuienMira(escalon, quien, task, state.circleId);
    tareas.push({ tareaId: task.taskId, escalon: visible ?? null });
  }
  return { tareas };
}

/**
 * Registra las rutas de este fichero sobre `app`. No añade `onRequest` ni error handler propios:
 * hereda el de `buildApp`, así que sólo tiene sentido llamarla después de que `buildApp` los instale
 * — igual que el resto de las rutas de `app.ts`.
 */
export function registrarRutasDeEscalones(app: FastifyInstance, ctx: ContextoEscalones): void {
  // GET /iniciativas/:id/escalones
  //   Exige: nada para llamar (la sesión, si viene, sólo decide qué peldaños se ven — nunca si la
  //   ruta responde). Devuelve: EscalonesDeIniciativa — una fila por tarea, `escalon: null` cuando
  //   no hay incumplimiento vigente o cuando quien pregunta no tiene ojos para ese peldaño.
  //   Ejemplo: fetch('/iniciativas/abc.../escalones', { headers: como(testigo) })
  app.get('/iniciativas/:id/escalones', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    z.object({}).strict().parse(request.query);
    let iniciativa: IniciativaConId;
    try {
      iniciativa = await verIniciativa(ctx.deps, id);
    } catch (error) {
      if (error instanceof ServicioError) {
        return reply.status(error.estado).send({ codigo: error.codigo, mensaje: error.message });
      }
      throw error;
    }
    const quien = await quienLlama(ctx, request);
    const ahora = instant(ctx.deps.ports.clock.now());
    return calcularEscalonesVisibles(ctx, iniciativa, quien, ahora);
  });
}
