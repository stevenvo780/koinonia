/**
 * Contrato de frontera para la ruta de lectura de aprendizajes que faltaba (ADR-0053): buscarlos
 * por parecido con un problema nuevo.
 *
 * ═══ Por qué este fichero no repite `entradaDeMemoria` ═══
 *
 * `evaluacion.ts` ya define el vocabulario de la memoria institucional —`entradaDeMemoria`,
 * `tipoDeAprendizaje`, `etiquetaDeAprendizaje`, `desenlaceEvaluacion`— porque `GET /aprendizajes`
 * (`rutas-evaluacion.ts`) ya lista y filtra esa memoria. Este incremento no repite eso: lo importa y
 * le añade una sola cosa que faltaba: **una razón para que una fila aparezca antes que otra cuando
 * lo que se trae a la mano es un problema nuevo, no una etiqueta exacta.**
 *
 * ═══ Léxico, no semántico: decilo en el contrato, no sólo en el código ═══
 *
 * `similitud` es la proporción de palabras significativas del problema nuevo (`titulo` + `cuerpo`)
 * que aparecen, tal cual, en el enunciado o las etiquetas del aprendizaje. No hay ningún proveedor
 * de lenguaje detrás: es coincidencia de palabras después de bajar a minúscula y quitar tildes,
 * nada más. `palabrasCoincidentes` es la prueba de eso — con qué palabras exactas se justificó cada
 * fila, para que quien lee no tenga que confiar en un puntaje que no puede auditar.
 */

import { z } from 'zod';

import { opaqueId } from './ids.js';
import {
  desenlaceEvaluacion,
  entradaDeMemoria,
  etiquetaDeAprendizaje,
  tipoDeAprendizaje,
} from './evaluacion.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Límites — una búsqueda es una descripción libre, no un aporte formal: los límites son generosos
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Un título de una sola palabra no da para comparar nada; tres caracteres alcanzan. */
export const MIN_LONGITUD_TITULO_PROBLEMA = 3;
export const MAX_LONGITUD_TITULO_PROBLEMA = 200;
/** Mismo techo que el cuerpo de una propuesta (`http.ts`): describir un problema no pide menos. */
export const MAX_LONGITUD_CUERPO_PROBLEMA = 4000;

export const LIMITE_RESULTADOS_POR_DEFECTO = 20;
export const LIMITE_RESULTADOS_MAXIMO = 50;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lo que se pide
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * El problema nuevo, descrito igual que se describiría una propuesta: un título corto y, si hace
 * falta más contexto, un cuerpo. Los cinco filtros de abajo son el mismo vocabulario que
 * `consultaDeAprendizajes` — no uno nuevo — para acotar el universo antes de puntuar parecido.
 */
export const buscarAprendizajesParecidos = z.object({
  titulo: z.string().min(MIN_LONGITUD_TITULO_PROBLEMA).max(MAX_LONGITUD_TITULO_PROBLEMA),
  cuerpo: z.string().max(MAX_LONGITUD_CUERPO_PROBLEMA).optional(),
  limite: z.coerce.number().int().positive().max(LIMITE_RESULTADOS_MAXIMO).optional(),
  etiqueta: etiquetaDeAprendizaje.optional(),
  tipo: tipoDeAprendizaje.optional(),
  desenlace: desenlaceEvaluacion.optional(),
  circuloId: opaqueId.optional(),
  decisionId: opaqueId.optional(),
});
export type BuscarAprendizajesParecidos = z.infer<typeof buscarAprendizajesParecidos>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lo que se enseña
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Una fila de la memoria (`entradaDeMemoria`) con la razón por la que apareció. `similitud` en
 * `[0, 1]`: 1 significa que todas las palabras significativas del problema nuevo están en este
 * aprendizaje; nunca aparece una fila con `similitud: 0` — eso es «no parecido» y no se lista.
 */
export const coincidenciaDeAprendizaje = entradaDeMemoria.extend({
  similitud: z.number().min(0).max(1),
  palabrasCoincidentes: z.array(z.string()),
});
export type CoincidenciaDeAprendizaje = z.infer<typeof coincidenciaDeAprendizaje>;

/** Ordenado por `similitud` descendente; a igualdad, se conserva el orden de `entradaDeMemoria`. */
export const resultadoDeBusquedaDeAprendizajes = z.array(coincidenciaDeAprendizaje);
export type ResultadoDeBusquedaDeAprendizajes = z.infer<typeof resultadoDeBusquedaDeAprendizajes>;
