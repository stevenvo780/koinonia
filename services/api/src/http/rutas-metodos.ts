/**
 * `GET /metodos` — el catálogo de los nueve métodos de votación que el sistema ofrece.
 *
 * La pantalla que abre una decisión necesita mostrar al facilitador la lista de métodos con su
 * nombre, su descripción en una frase, la forma de la papeleta que va a tener que dibujar y si
 * admite delegación. Esa lista está en `packages/contracts/src/metodos.ts` y se sirve acá, sin
 * paginar, sin filtrar y sin estado: la lista es la misma para todo el mundo, y la pantalla la
 * cruza una sola vez al cargar.
 *
 * ═══ Por qué no forma parte de `app.ts` ═══
 *
 * Es una sola ruta que no toca estado, no consulta base y no necesita autorización. Sigue el
 * mismo patrón de los otros cinco incrementos de esta fase (`rutas-evaluacion.ts`,
 * `rutas-asistente.ts`, `rutas-consenso.ts`, `rutas-iniciativas.ts`, `rutas-metricas.ts`):
 * una función registradora que `app.ts` llama, y un `ContextoMetodos` con exactamente lo que la
 * ruta necesita —en este caso, nada, porque el catálogo es estático y vive en `contracts`.
 *
 * ═══ Lo que se devuelve ═══
 *
 * La entrada del catálogo, menos el `configSchema` (que es un `ZodTypeAny` y no se serializa).
 * Se manda además el orden estable de la lista, en `METODOS_EN_ORDEN`, para que la pantalla no
 * tenga que ordenar por su cuenta: el orden es el orden pedagógico, de la regla más básica a la
 * más costosa de explicar, y se documenta en la cabecera de `metodos.ts`.
 *
 * Si el día de mañana el catálogo se vuelve por círculo (un círculo decide que sólo puede usar
 * tres de los nueve), la ruta puede pasar a devolver un subconjunto sin tocar la pantalla: se le
 * pasa el `circleId` por query y se cruza con un mapa de métodos admitidos por círculo. Hoy no
 * hace falta: la lista es la misma.
 */

import { METODOS_EN_ORDEN, type MetodoDisponible } from '@koinonia/contracts';
import type { FastifyInstance } from 'fastify';

/**
 * Lo que el cliente recibe por cada método: la entrada del catálogo sin el `configSchema`. La
 * forma es lo que la pantalla necesita para renderizar la tarjeta, validar la configuración y
 * mostrar la papeleta. No se manda el esquema Zod porque no es serializable.
 */
export interface MetodoEnRespuesta {
  readonly id: MetodoDisponible['id'];
  readonly nombre: string;
  readonly descripcion: string;
  readonly formasPapeleta: readonly string[];
  readonly delegacionPermitida: boolean;
}

function aRespuesta(metodo: MetodoDisponible): MetodoEnRespuesta {
  return {
    id: metodo.id,
    nombre: metodo.nombre,
    descripcion: metodo.descripcion,
    formasPapeleta: [...metodo.formasPapeleta],
    delegacionPermitida: metodo.delegacionPermitida,
  };
}

/**
 * Registra `GET /metodos` sobre un `FastifyInstance` ya existente.
 *
 * No llama a `app.setErrorHandler` (pisa el global). No depende de `request.quien` porque la ruta
 * no necesita identidad: la lista es la misma para quien entra y para quien no entra. El `no-store`
 * va por la misma razón que `/auth/estado`: una respuesta guardada por un intermediario sería una
 * lista vieja servida a quien podría abrir una votación con un método que el servidor ya no
 * soporta.
 */
export function registrarRutasDeMetodos(app: FastifyInstance): void {
  app.get('/metodos', async (_request, reply) => {
    void reply.header('cache-control', 'no-store');
    return METODOS_EN_ORDEN.map(aRespuesta);
  });
}
