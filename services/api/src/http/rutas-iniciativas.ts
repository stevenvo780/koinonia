/**
 * El tablero de iniciativas con su estado real — el hueco que este encargo existe para cerrar.
 *
 * `GET /iniciativas` (ya registrada en `app.ts`) sirve hoy `estado: 'por-empezar'` fijo para
 * cualquier iniciativa, en cualquier fase: es un literal de un solo valor, no un campo que cuente
 * nada (ver la cabecera de `packages/contracts/src/iniciativas.ts` para la evidencia completa). La
 * pantalla «Iniciativas» de PRODUCT.md §4 no puede pintar su Kanban mientras esa sea la única fuente.
 *
 * Este fichero no toca esa ruta ni ninguna otra: añade `GET /iniciativas/tablero`, que sirve el
 * mismo listado con el estado **derivado** de lo que el agregado realmente tiene escrito (ADR-0026:
 * un estado es un dato derivado, no una columna que alguien pueda escribir a mano). Es aditivo — un
 * agente integrador la registra desde `buildApp` (`services/api/src/http/app.ts`) igual que las
 * demás, sin que esto obligue a tocar la ruta vieja el mismo día; y cuando ese día llegue, la
 * sustitución es una línea: cambiar el `estado: 'por-empezar'` fijo de `iniciativaDto` (en
 * `presenters.ts`) por `derivarEstadoTableroIniciativa(state)`.
 *
 * ═══ Nota de integración ═══
 *
 * `packages/contracts/src/index.ts` ya reexporta `iniciativas.ts` (agente integrador posterior),
 * así que este módulo importa por `@koinonia/contracts` como el resto de las rutas.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  type AvanceIniciativa,
  derivarAvanceIniciativa,
  derivarEstadoTableroIniciativa,
  ESTADO_TABLERO_INICIATIVA_EN_PALABRAS,
  type EstadoTableroIniciativa,
} from '@koinonia/contracts';

import { type IniciativaConId, listarIniciativas, type ServicioDeps } from './service.js';

/** Exactamente lo que estas rutas necesitan del ámbito de `buildApp`: nada más. */
export interface ContextoIniciativas {
  readonly deps: ServicioDeps;
}

export interface TarjetaTableroIniciativa {
  readonly id: string;
  readonly circuloId: string;
  readonly decisionId: string;
  readonly objetivo: string;
  readonly estado: EstadoTableroIniciativa;
  readonly estadoEnPalabras: string;
  /** Provisional mientras dura la ventana de impugnación (ADR-0043); igual que en `iniciativaDto`. */
  readonly activa: boolean;
  readonly revisarEn: number;
  readonly avance: AvanceIniciativa;
}

export interface TableroIniciativas {
  readonly tarjetas: readonly TarjetaTableroIniciativa[];
  /** Todas las columnas presentes aunque estén vacías: un tablero sin `bloqueada` no omite la llave. */
  readonly totalesPorEstado: Readonly<Record<EstadoTableroIniciativa, number>>;
}

function tarjetaDe({ id, state }: IniciativaConId): TarjetaTableroIniciativa {
  const estado = derivarEstadoTableroIniciativa(state);
  return {
    id,
    circuloId: state.circleId,
    decisionId: state.decisionId,
    objetivo: state.executionPlan.objective,
    estado,
    estadoEnPalabras: ESTADO_TABLERO_INICIATIVA_EN_PALABRAS[estado],
    activa: state.activatedAt !== undefined,
    revisarEn: state.executionPlan.reviewAt,
    avance: derivarAvanceIniciativa(state),
  };
}

function totalesEnCero(): Record<EstadoTableroIniciativa, number> {
  return { 'por-empezar': 0, 'en-curso': 0, bloqueada: 0, 'en-revision': 0 };
}

/**
 * Registra las rutas de este fichero sobre `app`. No añade `onRequest` ni error handler propios:
 * hereda el de `buildApp`, así que sólo tiene sentido llamarla después de que `buildApp` los instale
 * — igual que las 65 rutas que ya viven en `app.ts`.
 */
export function registrarRutasDeIniciativas(app: FastifyInstance, ctx: ContextoIniciativas): void {
  // GET /iniciativas/tablero
  //   Exige: nada (pública, igual que GET /iniciativas hoy: sin sesión también se puede mirar qué
  //   se está haciendo con lo que se decidió — PRODUCT.md §4 no condiciona esta pantalla a entrar).
  //   Devuelve: TableroIniciativas — una tarjeta liviana por iniciativa con su estado REAL derivado
  //   del agregado, más los totales por columna para pintar el Kanban sin que el cliente cuente.
  //   Ejemplo: fetch('/iniciativas/tablero').then(r => r.json()) → { tarjetas: [...], totalesPorEstado: {...} }
  app.get('/iniciativas/tablero', async (request): Promise<TableroIniciativas> => {
    // Ruta sin parámetros hoy: filtrar por círculo o por estado queda para cuando la pantalla lo
    // pida. Aceptar una consulta que nadie envía todavía es superficie sin beneficio (mismo criterio
    // que `GET /historial` en app.ts).
    z.object({}).strict().parse(request.query);
    const iniciativas = await listarIniciativas(ctx.deps);
    const tarjetas = iniciativas.map(tarjetaDe);
    const totalesPorEstado = totalesEnCero();
    for (const tarjeta of tarjetas) totalesPorEstado[tarjeta.estado] += 1;
    return { tarjetas, totalesPorEstado };
  });
}
