/**
 * Rutas para cerrar el ciclo de una decisión aprobada.
 *
 * Cuando una decisión aprobada se cierra, la iniciativa nace automáticamente en la misma
 * transacción PostgreSQL (ADR-0043). Esta ruta expone de forma explícita ese flujo:
 * el facilitador puede cerrar una votación manualmente y confirmar que la iniciativa
 * se creó.
 *
 * La iniciativa nace PROVISIONAL (estado 'por-empezar') y permanece así hasta que se
 * ratifique tras la ventana de impugnación (DEFAULT_CHALLENGE_WINDOW_MS = 72h, ADR-0044).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Actor } from '@koinonia/domain';
import {
  cerrarCicloDeDecision,
  type EstadoCierre,
  type ResultadoCierre,
} from '@koinonia/contracts';

import type { ServicioDeps } from './service.js';
import { cerrarDecision, resultadoDeDecision } from './service.js';

/** Parsea con Zod y deja que el `ZodError` lo traduzca `errorDe` en `app.ts` (mismo patrón que el
 * resto de las rutas de este directorio: cada fichero define su propio `parse` local en vez de
 * importar el de `app.ts`, que no lo exporta — evita además el import circular hacia el fichero
 * que registra esta misma ruta). */
function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

/**
 * Contexto mínimo que esta ruta necesita.
 * Separado del contexto general para que sea evidente qué toca cada ruta.
 */
export interface ContextoCierreCiclo {
  readonly deps: ServicioDeps;
  /** Mismo cierre que `actorDe` en `app.ts`: no se importa de allí porque `app.ts` no lo exporta
   * (y porque importar desde el fichero que registra esta ruta sería un ciclo). */
  readonly actorDe: (request: FastifyRequest) => Actor;
}

/**
 * Registra las rutas de cierre de ciclo sobre app.
 *
 * @param app instancia Fastify donde registrar
 * @param ctx contexto con deps (puertos del servicio)
 *
 * Ejemplo de uso en buildApp:
 *   registrarRutasDeCierreCiclo(app, { deps })
 *
 * Las rutas se cablean después de que buildApp instale onRequest y error handlers.
 */
export function registrarRutasDeCierreCiclo(app: FastifyInstance, ctx: ContextoCierreCiclo): void {
  const { deps } = ctx;

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // POST /cierre-ciclo/:decisionId/cerrar
  //
  // Cierra una votación abierta de forma EXPLÍCITA (el facilitador lo pide, no el timeout).
  // Si el resultado es aprobado, la iniciativa nace automáticamente.
  //
  // La iniciativa nace PROVISIONAL: está viva, pero no se activa (no acepta trabajo) hasta
  // después de la ventana de impugnación (72h). Si en ese tiempo se anula la decisión, hay
  // un evento correctivo en el agregado, nunca un borrado.
  //
  // Garantías:
  // - DecisionClosed, ResultComputed e InitiativeCreated ocurren en UNA transacción (atómica)
  // - Doble envío con el mismo requestId devuelve la misma respuesta (idempotente)
  // - Si la iniciativa ya existe, error INTEGRITY_RESERVED_INITIATIVE_OCCUPIED
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  app.post('/cierre-ciclo/:decisionId/cerrar', async (request): Promise<ResultadoCierre> => {
    // Requiere permiso de escritura (solo facilitadores).
    // El rol concreto lo decide authorize() dentro de cerrarDecision.
    const actor = ctx.actorDe(request);

    // Valida parámetro: id opaco de decisión.
    const { decisionId } = parse(z.object({ decisionId: z.string() }), request.params);

    // Valida cuerpo: requestId para idempotencia + nota opcional.
    const cuerpo = parse(cerrarCicloDeDecision, request.body);

    // Llama al servicio que compone dominio + persistencia.
    // Este método ya maneja:
    // - closeDecisionBy(log, metadata) → cierra votación
    // - computeResult(log) → calcula veredicto
    // - recordResult(log, result) → anota el resultado computado
    // - Si outcome=approved y plan congelado existe: createInitiative(...)
    // - Ambas historias (decisión + iniciativa) se persisten juntas (atómica)
    const cerrada = await cerrarDecision(deps, actor, decisionId, {
      requestId: cuerpo.requestId,
    });

    // Construye la respuesta.
    // El veredicto lo trae el objeto ResultadoDecision, pero lo traducimos
    // al nombre que usa el contrato de cierre-ciclo ('aprobado' vs 'approved').
    const veredictoMap: Record<string, ResultadoCierre['veredicto']> = {
      approved: 'aprobado',
      rejected: 'rechazado',
      'no-quorum': 'sin-quórum',
      'needs-new-round': 'ronda-nueva',
    };

    const veredicto = veredictoMap[cerrada.resultado.outcome.kind];
    if (!veredicto) {
      throw new Error(`Veredicto desconocido: ${cerrada.resultado.outcome.kind}`);
    }

    // `DecisionResult` no lleva un `computedAt` propio (viaja con su prueba, no con su reloj de
    // pared — ver `packages/domain/src/tally/common.ts`); el instante en que el resultado se hizo
    // público vive en `DecisionState.resultComputedAt`, que `cerrarDecision` deja escrito en la
    // MISMA transacción que computa el veredicto, así que aquí siempre está definido.
    const computadoEn = cerrada.state.resultComputedAt;
    if (computadoEn === undefined) {
      throw new Error(
        'INTEGRITY_RESULT_COMPUTED_AT_MISSING: cerrarDecision devolvió un resultado sin ' +
          'resultComputedAt en el estado',
      );
    }

    const respuesta: ResultadoCierre = {
      decisionId: cerrada.resultado.decisionId,
      veredicto,
      computadoEn,
      resultHash: cerrada.resultado.resultHash,
      seManifestaron: cerrada.resultado.turnout.cast,
      cierreAutomatico: false, // Aquí fue explícito (lo pidió el facilitador)
    };

    // Si fue aprobado y se creó iniciativa, expone su id.
    if (veredicto === 'aprobado' && cerrada.iniciativaId !== undefined) {
      respuesta.iniciativaId = cerrada.iniciativaId;
    }

    return respuesta;
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // GET /cierre-ciclo/:decisionId/estado
  //
  // Consulta el estado actual de una decisión cerrada.
  // Devuelve si fue cerrada, qué veredicto tiene, y si existe iniciativa, su estado actual.
  //
  // Útil para:
  // - Facilitador que cierra una votación y quiere confirmar que quedó cerrada
  // - Miembro que quiere ver si una decisión aprobada ya tiene iniciativa activa
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  app.get('/cierre-ciclo/:decisionId/estado', async (request): Promise<EstadoCierre> => {
    // Ruta pública: sin sesión también se pueden consultar decisiones cerradas.
    const { decisionId } = parse(z.object({ decisionId: z.string() }), request.params);

    // Lee el estado actual de la decisión desde el event store.
    const found = await resultadoDeDecision(deps, decisionId);

    // Traduce el veredicto al nombre del contrato.
    const veredictoMap: Record<string, EstadoCierre['veredicto']> = {
      approved: 'aprobado',
      rejected: 'rechazado',
      'no-quorum': 'sin-quórum',
      'needs-new-round': 'ronda-nueva',
    };

    const veredicto = veredictoMap[found.resultado.outcome.kind];

    // `resultadoDeDecision` ya lanzó `NOT_CLOSED` (409) más arriba si `state.closedAt` no estaba
    // definido, así que llegar aquí ya implica cerrada; `DecisionResult` no lleva su propio
    // `computedAt` (ver la nota de la ruta POST de arriba) — el campo vive en el estado.
    const respuesta: EstadoCierre = {
      decisionId,
      cerrada: found.state.closedAt !== undefined,
    };

    if (respuesta.cerrada && veredicto) {
      respuesta.veredicto = veredicto;

      // Si fue aprobado y existe iniciativa, expone su id y estado.
      if (veredicto === 'aprobado' && found.iniciativaId !== undefined) {
        respuesta.iniciativaId = found.iniciativaId;

        // Aquí podría leerse el estado actual de la iniciativa para exponer
        // el estado real ('por-empezar', 'en-curso', etc.) y si está activa.
        // Por ahora, queda para cuando se cablee con la ruta de iniciativas.
        // Lo que sí se puede hacer es: si la ruta tiene acceso a iniciativas,
        // llamar a loadInitiativeState() y derivar el estado.
        // Detalles en: rutas-iniciativas.ts función derivarEstadoTableroIniciativa()
      }
    }

    return respuesta;
  });
}
