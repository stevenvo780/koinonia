'use client';

/**
 * Una acción a la vez, y **una sola clave de idempotencia por intención**.
 *
 * El patrón estaba escrito a mano —dos veces, con dos copias que había que arreglar por separado—
 * en `iniciativas/[id]` y en `mis-tareas`, y no estaba en ningún otro sitio. Las nueve pantallas
 * restantes llamaban a `nuevoRequestId()` dentro del manejador, con dos consecuencias que se notan
 * justamente donde más duele —una papeleta y el cierre de una decisión—:
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
 *
 * `iniciativas/[id]` y `mis-tareas` lo tenían copiado a mano y ya no: usan esto. Las copias
 * obligaban a arreglar cada fallo tres veces, y de hecho las dos pantallas de `deliberaciones` —que
 * no tenían ni la copia— dejaban pasar el segundo toque y renovaban la clave en cada llamada, que
 * es exactamente el par de agujeros que este módulo existe para tapar. La copia de `mis-tareas`,
 * además, borraba el mapa de claves en **cada** vuelta al foco de la ventana, porque el mismo
 * efecto que descarta los datos privados al cambiar de sujeto corría también cuando la cookie se
 * revalidaba y devolvía a la misma persona; con eso, el reintento tras un 401 pasajero llevaba una
 * clave nueva y podía escribir dos veces. Ese es el tipo de fallo que la copia obliga a descubrir
 * por separado en cada pantalla, y el motivo de que la premisa del módulo sólo sea cierta cuando no
 * queda ninguna copia.
 */

import { useCallback, useRef, useState } from 'react';

import { nuevoRequestId } from './api';

/** Qué pasó con el intento. Explícito, porque «no hice nada» y «falló» exigen pinturas distintas. */
export type Resultado<T> =
  | { readonly estado: 'hecho'; readonly valor: T }
  /**
   * No hay nada que pintar. Cubre dos casos que la pantalla no necesita distinguir:
   *
   *  - **Ya había otra acción en vuelo**: este toque se descarta en silencio, que es lo correcto.
   *  - **La sesión se rehízo mientras la llamada estaba en el aire** (`reiniciar`): la respuesta
   *    pertenece a una identidad que ya no es la vigente y no puede tocar la vista.
   *
   * Se dicen igual a propósito. En los dos casos la única conducta correcta es no pintar nada, y
   * un tercer estado obligaría a cada pantalla a decidir algo que no cambia lo que hace.
   */
  | { readonly estado: 'ignorado' }
  | { readonly estado: 'fallo'; readonly error: unknown };

export interface AccionUnica {
  /** Clave de la acción en curso, o `undefined`. Para rotular botones y deshabilitar el resto. */
  readonly enCurso: string | undefined;
  /**
   * Corre `llamar` con una clave de idempotencia estable para `clave` + `datos`.
   *
   * @param clave  Identifica la intención dentro de la pantalla («papeleta», `retirar-${id}`…).
   *               Una pantalla con muchas filas usa la fila en la clave —`responder-${tareaId}`—
   *               y así cada una lleva su propia idempotencia sin dejar de compartir el cerrojo.
   * @param datos  Lo que define que la intención es *la misma*. Si cambia, la clave se renueva.
   * @param llamar Recibe el `requestId` que hay que mandar en el cuerpo. Se invoca **sólo** si el
   *               cerrojo se tomó, así que sirve para limpiar avisos sin que un toque descartado
   *               borre el error que la persona todavía no leyó.
   */
  readonly ejecutar: <T>(
    clave: string,
    datos: unknown,
    llamar: (requestId: string) => Promise<T>,
  ) => Promise<Resultado<T>>;
  /** Olvida la clave de una intención sin haberla cumplido. Para cancelaciones explícitas. */
  readonly olvidar: (clave: string) => void;
  /**
   * Olvida **todas** las intenciones pendientes.
   *
   * Para cuando quien mira deja de ser quien era: una clave de idempotencia recuerda un borrador
   * de la cuenta anterior, y reusarla haría que el reintento de otra persona se dedujera duplicado
   * del comando de la primera. Se separa de `reiniciar` porque una revalidación de cookie de la
   * *misma* persona debe conservarlas —es justamente lo que permite reintentar tras un 401 sin
   * escribir dos veces—.
   */
  readonly olvidarTodo: () => void;
  /**
   * Suelta el cerrojo y desentiende lo que esté en vuelo.
   *
   * La llamada anterior sigue viva —no hay forma de cancelar una escritura ya enviada—, pero su
   * respuesta vuelve como `ignorado` y su `finally` ya no puede soltar el cerrojo de una acción
   * posterior. Sin esto, una sesión que se revalida deja la pantalla trabada hasta que conteste
   * una petición que ya no le importa a nadie.
   */
  readonly reiniciar: () => void;
}

export function useAccionUnica(): AccionUnica {
  const [enCurso, setEnCurso] = useState<string | undefined>(undefined);
  const enCursoRef = useRef<string | undefined>(undefined);
  const intentos = useRef(
    new Map<string, { readonly huella: string; readonly requestId: string }>(),
  );
  /** Qué tanda de acciones vale. `reiniciar` la avanza y con eso jubila lo que quedó en el aire. */
  const generacion = useRef(0);

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

      const mia = generacion.current;
      enCursoRef.current = clave;
      setEnCurso(clave);
      try {
        const valor = await llamar(requestId);
        // Una respuesta de una tanda jubilada no se aplica y **no borra la clave**: si aquello
        // llegó a escribirse, el reintento de esta persona lo reconocerá por el mismo `requestId`.
        if (generacion.current !== mia) return { estado: 'ignorado' };
        // Cumplida la intención, la clave se olvida: la siguiente es otra intención y merece otra.
        intentos.current.delete(clave);
        return { estado: 'hecho', valor };
      } catch (error: unknown) {
        if (generacion.current !== mia) return { estado: 'ignorado' };
        // La clave **se conserva**: si esto fue una respuesta perdida, el reintento lleva la misma
        // y el servidor no escribe dos veces.
        return { estado: 'fallo', error };
      } finally {
        // Sólo suelta el cerrojo quien lo tomó y sigue vigente. De lo contrario una llamada
        // jubilada abriría la puerta en mitad de la acción que la reemplazó.
        if (generacion.current === mia) {
          enCursoRef.current = undefined;
          setEnCurso(undefined);
        }
      }
    },
    [],
  );

  const olvidar = useCallback((clave: string) => {
    intentos.current.delete(clave);
  }, []);

  const olvidarTodo = useCallback(() => {
    intentos.current.clear();
  }, []);

  const reiniciar = useCallback(() => {
    generacion.current += 1;
    enCursoRef.current = undefined;
    setEnCurso(undefined);
  }, []);

  return { enCurso, ejecutar, olvidar, olvidarTodo, reiniciar };
}
