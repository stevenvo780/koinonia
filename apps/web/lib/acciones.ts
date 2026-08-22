'use client';

/**
 * Una acción a la vez, y **una sola clave de idempotencia por intención**.
 *
 * El patrón estaba escrito a mano en `iniciativas/[id]` y en `mis-tareas`, y no estaba en ningún
 * otro sitio. Las nueve pantallas restantes llamaban a `nuevoRequestId()` dentro del manejador, con
 * dos consecuencias que se notan justamente donde más duele —una papeleta y el cierre de una
 * decisión—:
 *
 *  1. **Nada impedía el segundo envío.** Un `disabled` gobernado por estado de React no sirve: el
 *     estado se aplica en el siguiente render, y los dos toques de un doble toque móvil caen antes.
 *     La guarda tiene que ser síncrona, y por eso vive en un `ref`.
 *  2. **El servidor no podía deduplicar.** Si cada llamada lleva una clave nueva, dos llamadas son
 *     dos comandos distintos por definición, y el `requestId` deja de proteger nada.
 *
 * De ahí la regla que implementa este módulo: **la clave de idempotencia pertenece a la intención
 * de la persona, no a la llamada HTTP**. Mientras la intención no cambie —misma acción, mismos
 * datos— el reintento reusa la clave y el servidor reconoce el comando que quizá ya escribió. Una
 * respuesta perdida en un bus con datos móviles deja de ser un aporte duplicado en un historial que
 * no se puede corregir. La clave sólo se olvida cuando la intención se cumple.
 */

import { useCallback, useRef, useState } from 'react';

import { nuevoRequestId } from './api';

/** Qué pasó con el intento. Explícito, porque «no hice nada» y «falló» exigen pinturas distintas. */
export type Resultado<T> =
  | { readonly estado: 'hecho'; readonly valor: T }
  /** Ya había otra acción en vuelo: este toque se descarta en silencio, que es lo correcto. */
  | { readonly estado: 'ignorado' }
  | { readonly estado: 'fallo'; readonly error: unknown };

export interface AccionUnica {
  /** Clave de la acción en curso, o `undefined`. Para rotular botones y deshabilitar el resto. */
  readonly enCurso: string | undefined;
  /**
   * Corre `llamar` con una clave de idempotencia estable para `clave` + `datos`.
   *
   * @param clave  Identifica la intención dentro de la pantalla («papeleta», `retirar-${id}`…).
   * @param datos  Lo que define que la intención es *la misma*. Si cambia, la clave se renueva.
   * @param llamar Recibe el `requestId` que hay que mandar en el cuerpo.
   */
  readonly ejecutar: <T>(
    clave: string,
    datos: unknown,
    llamar: (requestId: string) => Promise<T>,
  ) => Promise<Resultado<T>>;
  /** Olvida la clave de una intención sin haberla cumplido. Para cancelaciones explícitas. */
  readonly olvidar: (clave: string) => void;
}

export function useAccionUnica(): AccionUnica {
  const [enCurso, setEnCurso] = useState<string | undefined>(undefined);
  const enCursoRef = useRef<string | undefined>(undefined);
  const intentos = useRef(
    new Map<string, { readonly huella: string; readonly requestId: string }>(),
  );

  const ejecutar = useCallback(
    async <T>(
      clave: string,
      datos: unknown,
      llamar: (requestId: string) => Promise<T>,
    ): Promise<Resultado<T>> => {
      // Síncrono y antes de cualquier `await`: es la única forma de que el segundo toque de un
      // doble toque —que llega antes de que React repinte— no entre.
      if (enCursoRef.current !== undefined) return { estado: 'ignorado' };

      const huella = JSON.stringify([clave, datos]);
      const previo = intentos.current.get(clave);
      const requestId = previo?.huella === huella ? previo.requestId : nuevoRequestId();
      intentos.current.set(clave, { huella, requestId });

      enCursoRef.current = clave;
      setEnCurso(clave);
      try {
        const valor = await llamar(requestId);
        // Cumplida la intención, la clave se olvida: la siguiente es otra intención y merece otra.
        intentos.current.delete(clave);
        return { estado: 'hecho', valor };
      } catch (error: unknown) {
        // La clave **se conserva**: si esto fue una respuesta perdida, el reintento lleva la misma
        // y el servidor no escribe dos veces.
        return { estado: 'fallo', error };
      } finally {
        enCursoRef.current = undefined;
        setEnCurso(undefined);
      }
    },
    [],
  );

  const olvidar = useCallback((clave: string) => {
    intentos.current.delete(clave);
  }, []);

  return { enCurso, ejecutar, olvidar };
}
