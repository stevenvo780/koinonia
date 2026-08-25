/**
 * `services/api/src/http/rutas-seguimiento.ts`: la frontera HTTP de los tres huecos de seguimiento
 * que sí exigen leer el agregado real (el cuarto —que la ayuda solicitada detenga el reloj— resultó
 * ya corregido en una ronda anterior de `execution/escalones.ts`, verificado y sin cambios en este
 * encargo: ver la nota al final de este fichero).
 *
 * `packages/domain/src/execution/{informe-periodico,retiro-de-encargo,destrabe-de-dependencia}.ts`
 * calculan las tres reglas puras; este fichero hace lo que esos módulos, a propósito, no hacen: leer
 * el estado real de la iniciativa y —donde el ledger todavía no persiste el dato que la regla
 * necesita— documentar el hueco de integración en vez de fabricarlo.
 *
 * ═══ Tres rutas, tres huecos de persistencia distintos ═══
 *
 *  1. `GET /iniciativas/:id/seguimiento/destrabes` — sin hueco: `InitiativeTask.dependsOn` y
 *     `completedAt` ya existen en el ledger real (`workspace/initiative.ts`), así que esta ruta lee
 *     datos genuinos de principio a fin. Es la única de las tres que no depende de nada pendiente.
 *
 *  2. `GET /iniciativas/:id/seguimiento/informe` — hueco declarado: `InitiativeState` no tiene
 *     todavía ningún evento que persista un informe rendido (ver la cabecera de
 *     `execution/informe-periodico.ts`). Esta ruta sí lee el dato real que existe —`activatedAt`,
 *     desde cuándo corre el primer plazo— y acepta `ultimoInformeEn` como parámetro de consulta
 *     opcional para el resto, documentando explícitamente que es una entrada del llamador y no una
 *     lectura del ledger. El día que exista el evento, sólo cambia de dónde sale ese número.
 *
 *  3. `POST /iniciativas/:id/tareas/:tareaId/retiro-de-encargo` — hueco declarado por partida doble:
 *     ni existe el evento que aplicaría el retiro en `workspace/initiative.ts`, ni esta ruta
 *     recalcula el peldaño con el cruce de círculo completo que ya vive, sin duplicar, en
 *     `calcularEscalonesVisibles` (`rutas-escalones.ts`) — así que `escalonActual` entra como
 *     parámetro del llamador (que ya lo obtuvo de `GET /iniciativas/:id/escalones`), no como una
 *     segunda copia de ese cálculo cruzado. Lo que esta ruta sí hace con datos reales: confirma que
 *     la tarea existe en esa iniciativa antes de evaluar nada, y estampa `decididoEn` con el reloj
 *     del servidor — nunca con un instante que pudiera mandar el cliente — para que el registro que
 *     produce sea el que de verdad se puede auditar después.
 *
 * Ninguna de las tres aplica nada al ledger: como `execution/escalones.ts` documenta para
 * `puedeSuspenderDominio`, no hay evento de `workspace/initiative.ts` (fuera de mi ámbito de
 * escritura en este encargo) que este fichero pueda emitir. Las tres son de evaluación y lectura.
 *
 * ═══ Cómo se integra ═══
 *
 * Este fichero es nuevo y `app.ts` todavía no llama a `registrarRutasDeSeguimiento` — un agente
 * integrador posterior lo hace desde `buildApp`, exactamente como ya le tocó a
 * `registrarRutasDeEscalones` (ver la nota de integración en `rutas-escalones.ts`, que resolvió el
 * mismo problema de orden). `ContextoSeguimiento` sólo pide `deps: ServicioDeps`, ya disponible en
 * `buildApp`.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  destrabesDeConjunto,
  edadDelInformeVencidoMs,
  ESCALONES_DE_TAREA,
  informeVencido,
  instant,
  MAX_MOTIVO_RETIRO_LENGTH,
  MIN_MOTIVO_RETIRO_LENGTH,
  PreconditionError,
  proximoInformeVenceEn,
  registrarRetiroDeEncargo,
  taskId as toTaskId,
  type EstadoDeInformesDeIniciativa,
  type RetiroDeEncargoRegistrado,
  type TareaParaDestrabe,
} from '@koinonia/domain';

import {
  type IniciativaConId,
  ServicioError,
  verIniciativa,
  type ServicioDeps,
} from './service.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ContextoSeguimiento {
  readonly deps: ServicioDeps;
}

async function iniciativaOError(
  ctx: ContextoSeguimiento,
  id: string,
): Promise<
  | IniciativaConId
  | {
      readonly error: {
        readonly estado: number;
        readonly codigo: string;
        readonly mensaje: string;
      };
    }
> {
  try {
    return await verIniciativa(ctx.deps, id);
  } catch (error) {
    if (error instanceof ServicioError) {
      return { error: { estado: error.estado, codigo: error.codigo, mensaje: error.message } };
    }
    throw error;
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 1. Destrabes de dependencia — el único de los tres sin hueco de persistencia.
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface DestrabeDto {
  readonly tareaId: string;
  readonly dependenciaCompletadaId: string;
  readonly destrabadaEn: number;
}

function tareasParaDestrabe(iniciativa: IniciativaConId): readonly TareaParaDestrabe[] {
  return iniciativa.state.tasks.map((task) => ({
    taskId: task.taskId,
    dependsOn: task.dependsOn,
    completedAt: task.completedAt,
  }));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 2. Informe periódico — hueco declarado: `ultimoInformeEn` viene de la consulta, no del ledger.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const consultaInforme = z
  .object({ ultimoInformeEn: z.coerce.number().int().nonnegative().optional() })
  .strict();

export interface InformeSeguimientoDto {
  /** `false` si la iniciativa todavía no se ratificó (ADR-0044): el reloj de informes no corre. */
  readonly aplica: boolean;
  readonly activadaEn: number | null;
  readonly proximoVenceEn: number | null;
  readonly vencido: boolean;
  /** Milisegundos de atraso, o `null` si no está vencido. */
  readonly edadVencidoMs: number | null;
}

function informeDto(
  iniciativa: IniciativaConId,
  ahora: number,
  ultimoInformeEn?: number,
): InformeSeguimientoDto {
  if (iniciativa.state.activatedAt === undefined) {
    return {
      aplica: false,
      activadaEn: null,
      proximoVenceEn: null,
      vencido: false,
      edadVencidoMs: null,
    };
  }
  const estado: EstadoDeInformesDeIniciativa = {
    activadaEn: iniciativa.state.activatedAt,
    informes: ultimoInformeEn === undefined ? [] : [{ rendidoEn: instant(ultimoInformeEn) }],
  };
  const ahoraInstant = instant(ahora);
  return {
    aplica: true,
    activadaEn: estado.activadaEn,
    proximoVenceEn: proximoInformeVenceEn(estado),
    vencido: informeVencido(estado, ahoraInstant),
    edadVencidoMs: edadDelInformeVencidoMs(estado, ahoraInstant) ?? null,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 3. Retiro de encargo (peldaño 7) — hueco declarado por partida doble, ver cabecera.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const cuerpoRetiro = z
  .object({
    escalonActual: z.enum(ESCALONES_DE_TAREA).nullable(),
    consentimientoDelCirculo: z.boolean(),
    motivo: z.string().min(MIN_MOTIVO_RETIRO_LENGTH).max(MAX_MOTIVO_RETIRO_LENGTH),
  })
  .strict();

export interface RetiroDeEncargoDto {
  readonly tareaId: string;
  readonly peldano: RetiroDeEncargoRegistrado['peldano'];
  readonly motivo: string;
  readonly decididoEn: number;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Registra las rutas de este fichero sobre `app`. No añade `onRequest` ni error handler propios:
 * hereda el de `buildApp`, así que sólo tiene sentido llamarla después de que `buildApp` los instale
 * — igual que el resto de las rutas de `app.ts`.
 */
export function registrarRutasDeSeguimiento(app: FastifyInstance, ctx: ContextoSeguimiento): void {
  // GET /iniciativas/:id/seguimiento/destrabes
  //   Exige: nada (pública, igual que GET /iniciativas/:id/escalones: la estructura de dependencias
  //   ya es explícita en la interfaz — PRODUCT.md §6 — así que no hay nada que ocultar aquí).
  //   Devuelve: { destrabes: DestrabeDto[] } — el hecho «esta tarea quedó desbloqueada en tal
  //   instante, por tal dependencia», listo para que una notificación futura lo lea sin recalcular.
  //   Ejemplo: fetch('/iniciativas/abc.../seguimiento/destrabes').then(r => r.json())
  app.get('/iniciativas/:id/seguimiento/destrabes', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    z.object({}).strict().parse(request.query);
    const resultado = await iniciativaOError(ctx, id);
    if ('error' in resultado) {
      return reply
        .status(resultado.error.estado)
        .send({ codigo: resultado.error.codigo, mensaje: resultado.error.mensaje });
    }
    const destrabes = destrabesDeConjunto(tareasParaDestrabe(resultado)).map(
      (hecho): DestrabeDto => ({
        tareaId: hecho.taskId,
        dependenciaCompletadaId: hecho.dependenciaCompletadaId,
        destrabadaEn: hecho.destrabadaEn,
      }),
    );
    return { destrabes };
  });

  // GET /iniciativas/:id/seguimiento/informe?ultimoInformeEn=<ms>
  //   Exige: nada. Devuelve: InformeSeguimientoDto — ver la cabecera para el hueco de persistencia
  //   que `ultimoInformeEn` (opcional; ausente significa «nunca se rindió ninguno») cubre por ahora.
  //   Ejemplo: fetch('/iniciativas/abc.../seguimiento/informe?ultimoInformeEn=1750000000000')
  app.get('/iniciativas/:id/seguimiento/informe', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { ultimoInformeEn } = consultaInforme.parse(request.query);
    const resultado = await iniciativaOError(ctx, id);
    if ('error' in resultado) {
      return reply
        .status(resultado.error.estado)
        .send({ codigo: resultado.error.codigo, mensaje: resultado.error.mensaje });
    }
    const ahora = ctx.deps.ports.clock.now();
    return informeDto(resultado, ahora, ultimoInformeEn);
  });

  // POST /iniciativas/:id/tareas/:tareaId/retiro-de-encargo
  //   Exige: `consentimientoDelCirculo: true` y un `motivo` de al menos MIN_MOTIVO_RETIRO_LENGTH
  //   caracteres — nunca automático, siempre motivado (PRODUCT.md §6, peldaño 7). `escalonActual`
  //   lo aporta el llamador (ver cabecera: evita duplicar el cruce de círculo de rutas-escalones.ts).
  //   Devuelve: 201 con RetiroDeEncargoDto si las tres condiciones se cumplen; 404 si la tarea no
  //   existe en esa iniciativa; 422 con el código exacto del rechazo (PreconditionError) si no.
  //   No aplica nada al ledger: ver cabecera.
  app.post('/iniciativas/:id/tareas/:tareaId/retiro-de-encargo', async (request, reply) => {
    const { id, tareaId } = z
      .object({ id: z.string().min(1), tareaId: z.string().min(1) })
      .parse(request.params);
    const cuerpo = cuerpoRetiro.parse(request.body);

    const resultado = await iniciativaOError(ctx, id);
    if ('error' in resultado) {
      return reply
        .status(resultado.error.estado)
        .send({ codigo: resultado.error.codigo, mensaje: resultado.error.mensaje });
    }
    const tareaExiste = resultado.state.tasks.some((task) => task.taskId === toTaskId(tareaId));
    if (!tareaExiste) {
      return reply.status(404).send({
        codigo: 'TAREA_NO_ENCONTRADA',
        mensaje: 'esa tarea no existe en esta iniciativa',
      });
    }

    const ahora = instant(ctx.deps.ports.clock.now());
    try {
      const registrado = registrarRetiroDeEncargo(
        {
          escalonActual: cuerpo.escalonActual ?? undefined,
          consentimientoDelCirculo: cuerpo.consentimientoDelCirculo,
          motivo: cuerpo.motivo,
        },
        ahora,
      );
      const dto: RetiroDeEncargoDto = {
        tareaId,
        peldano: registrado.peldano,
        motivo: registrado.motivo,
        decididoEn: registrado.decididoEn,
      };
      return await reply.status(201).send(dto);
    } catch (error) {
      if (error instanceof PreconditionError) {
        return reply.status(422).send({ codigo: error.code, mensaje: error.message });
      }
      throw error;
    }
  });
}

/**
 * ═══ Nota sobre el cuarto hueco del encargo: «TaskHelpRequested detiene el reloj» ═══
 *
 * Verificado, no corregido: ya lo detiene. `calcularEscalonDeTarea` (`execution/escalones.ts`)
 * comprueba `ESTADO_A_ESCALON` (que incluye `en-apoyo`) ANTES que `ESTADOS_CON_RELOJ_ACTIVO`, así
 * que una tarea en `en-apoyo` nunca llega a `escalonPorTiempo`: el peldaño se congela en `en-apoyo`
 * sin importar cuánto tiempo pase, exactamente lo que PRODUCT.md §6 exige («Declarar bloqueo o pedir
 * ayuda detiene el reloj»). `metricas-lecturas.ts` coincide de forma independiente:
 * `relojDetenido: tarea.currentPause !== undefined`, y `TaskHelpRequested` en
 * `workspace/initiative.ts` sí fija `currentPause` (kind `'support'` si la tarea no estaba ya
 * bloqueada, o reutiliza la pausa vigente si ya lo estaba). `packages/domain/test/escalones.test.ts`
 * ya prueba esto explícitamente (`«en-apoyo» pesa igual, con el reloj detenido en cualquier
 * instante»`, línea 100). No hay ningún cambio de código para este punto: la verificación en sí es
 * el entregable.
 */
