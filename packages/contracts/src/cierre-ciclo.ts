/**
 * Contrato HTTP para cerrar el ciclo de una decisión aprobada.
 *
 * La iniciativa nace automáticamente en la misma transacción que el resultado,
 * garantizado por ADR-0043. Esta ruta expone esa creación de forma explícita
 * para que el facilitador pueda cerrar una votación manualmente (no solo por timeout)
 * y confirmar que la iniciativa se creó.
 *
 * Restricciones de dominio:
 * - Solo decisiones aprobadas crean iniciativa (outcomeKind === 'approved')
 * - La iniciativa nace PROVISIONAL y se activa tras DEFAULT_CHALLENGE_WINDOW_MS (72h)
 * - No hay iniciativa sin plan de ejecución congelado
 */

import { z } from 'zod';
import { hash64, instantMs, opaqueId, requestId } from './ids.js';

/**
 * POST /cierre-ciclo/:decisionId/cerrar
 * Cierra una votación abierta y computa el resultado.
 * Si fue aprobado, crea la iniciativa asociada atomicamente.
 */
export const cerrarCicloDeDecision = z.object({
  requestId,
  /**
   * Razón o nota del facilitador al cerrar (opcional, para auditoría).
   * Máximo 500 caracteres.
   */
  nota: z.string().max(500).optional(),
});
export type CerrarCicloDeDecision = z.infer<typeof cerrarCicloDeDecision>;

/**
 * Respuesta de éxito al cerrar una decisión.
 * Incluye el resultado computado y, si fue aprobado, el identificador de la iniciativa creada.
 */
export const resultadoCierre = z.object({
  /**
   * El id opaco de la decisión que se acaba de cerrar.
   */
  decisionId: opaqueId,
  /**
   * Resultado de la votación: 'aprobado', 'rechazado', 'sin-quórum' o 'ronda-nueva'.
   */
  veredicto: z.enum(['aprobado', 'rechazado', 'sin-quórum', 'ronda-nueva']),
  /**
   * Si el veredicto es 'aprobado', aquí va el id de la iniciativa PROVISIONAL que se creó.
   * Estará activa (lista para recibir trabajo) tras la ventana de impugnación (72h).
   */
  iniciativaId: opaqueId.optional(),
  /**
   * Cuando se computó el resultado (marcado por el servidor).
   */
  computadoEn: instantMs,
  /**
   * Huella canónica del resultado (para auditoría y verificación).
   */
  resultHash: hash64,
  /**
   * Participación neta: cuantas personas emitieron papeleta.
   */
  seManifestaron: z.number().int().nonnegative(),
  /**
   * Si el servidor cerró por expiración de la ventana (cierre automático por timeout).
   */
  cierreAutomatico: z.boolean(),
});
export type ResultadoCierre = z.infer<typeof resultadoCierre>;

/**
 * GET /cierre-ciclo/:decisionId/estado
 * Consulta el estado actual de cierre de una decisión.
 * Devuelve si fue cerrada, qué veredicto tiene, e información de la iniciativa (si existe).
 */
export const estadoCierre = z.object({
  decisionId: opaqueId,
  /**
   * true si la votación ya se cerró, false si sigue abierta.
   */
  cerrada: z.boolean(),
  /**
   * Si cerrada=true, el veredicto ('aprobado', 'rechazado', 'sin-quórum', 'ronda-nueva').
   * Undefined si aún está abierta.
   */
  veredicto: z.enum(['aprobado', 'rechazado', 'sin-quórum', 'ronda-nueva']).optional(),
  /**
   * Si veredicto=aprobado, el id de la iniciativa creada.
   */
  iniciativaId: opaqueId.optional(),
  /**
   * Si la iniciativa existe, su estado actual: 'por-empezar', 'en-curso', 'bloqueada', 'en-revision'.
   */
  estadoIniciativa: z.enum(['por-empezar', 'en-curso', 'bloqueada', 'en-revision']).optional(),
  /**
   * Si la iniciativa existe, true si fue ratificada (pasó la ventana de impugnación).
   */
  iniciativaActiva: z.boolean().optional(),
});
export type EstadoCierre = z.infer<typeof estadoCierre>;
