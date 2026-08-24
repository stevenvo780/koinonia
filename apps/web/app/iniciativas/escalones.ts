/**
 * Los peldaños de incumplimiento (ADR-0040) dichos en pantalla: qué palabra le toca a cada uno, qué
 * explica, de qué color se pinta y quién puede verlo.
 *
 * ═══ Por qué este fichero es puro y no trae JSX ═══
 *
 * `apps/web` no tiene suite unitaria (docs/TESTING.md §6: se cubre por E2E) y este encargo no puede
 * añadir dependencias (regla 4), así que no hay forma de renderizar React en `vitest`. Pero lo que
 * de verdad hay que proteger acá **no es el marcado**: es el TONO, y el tono vive entero en estas
 * tablas. Separarlas del componente las vuelve comprobables con el `vitest` que ya existe
 * (`tests/unit/escalones-interfaz.test.ts`), y ahí quedan atadas tres invariantes que ADR-0040 pide
 * y que un cambio descuidado rompería sin que nadie se diera cuenta:
 *
 *  1. **Ningún peldaño se pinta como fracaso.** `VarianteFicha` tiene un valor `mal` (la ✕ roja) que
 *     esta tabla no usa **nunca**. Atrasarse no es un veredicto negativo sobre nadie; es un estado
 *     del trabajo que hay que replanear. Si alguien escribe `atrasada: 'mal'`, la prueba se pone en
 *     rojo — que es exactamente lo que tiene que pasar.
 *  2. **Los peldaños públicos no le hablan a la persona.** `por-vencer` y `consultada` son los dos
 *     que el pliego reserva a quien tiene la tarea («recordatorio privado», «sólo la persona»), y
 *     por eso pueden tutear —vosear— sin señalar a nadie ante el círculo. Los otros cinco los ve el
 *     círculo entero, así que su redacción habla de **la tarea** y jamás en segunda persona: un «no
 *     entregaste» leído por doce personas es la humillación que el pliego prohíbe con esas palabras.
 *  3. **Qué es privado lo decide el servidor, y esta tabla tiene que coincidir con él.**
 *     `services/api/src/http/rutas-escalones.ts` filtra `por-vencer` y `consultada` para quien no
 *     tiene la tarea (`PELDANOS_PRIVADOS`). `ESCALON_PRIVADO`, acá, no vuelve a filtrar nada —sería
 *     una segunda autoridad sobre lo mismo—: sólo sirve para **decirlo en pantalla** («esto sólo lo
 *     ves vos»), que es la mitad del requisito que el servidor no puede cumplir. La prueba compara
 *     las dos listas para que no se separen en silencio.
 *
 * ═══ Por qué los tipos son locales y no de `@koinonia/contracts` ═══
 *
 * `EscalonTarea` vive en `packages/domain/src/execution/escalones.ts` y la forma de la respuesta en
 * `services/api/src/http/rutas-escalones.ts` (`EscalonesDeIniciativa`). Ninguno de los dos pasa por
 * el paquete de contratos —no hay `packages/contracts/src/escalones.ts`—, y ese fichero está fuera
 * de mi propiedad. Estas declaraciones son copia verificada campo a campo contra ese servidor, no
 * un tipo inventado; el día que exista el contrato, se sustituyen por un `import` y la prueba de
 * `ESCALONES_DE_TAREA` sigue valiendo igual.
 */

/** Los siete peldaños, en el orden de la escalera de ADR-0040. El octavo no es de esta lista. */
export const ESCALONES_DE_TAREA = [
  'por-vencer',
  'atrasada',
  'consultada',
  'bloqueada',
  'en-apoyo',
  'reasignada',
  'en-revision-colectiva',
] as const;
export type EscalonTarea = (typeof ESCALONES_DE_TAREA)[number];

/** Una fila de la respuesta: `escalon: null` cuando no hay peldaño o cuando no toca verlo. */
export interface EscalonDeTarea {
  readonly tareaId: string;
  readonly escalon: EscalonTarea | null;
}

/** El cuerpo de `GET /iniciativas/:id/escalones`. Una fila por tarea, jamás una por persona. */
export interface EscalonesDeIniciativa {
  readonly tareas: readonly EscalonDeTarea[];
}

/**
 * El rótulo corto de la ficha. Todos nombran a la TAREA o a lo que le pasa a la tarea; ninguno
 * nombra ni describe a quien la lleva.
 */
export const ESCALON_EN_PALABRAS: Readonly<Record<EscalonTarea, string>> = {
  'por-vencer': 'Se acerca la fecha',
  atrasada: 'Pasó la fecha',
  consultada: 'Toca preguntar cómo va',
  bloqueada: 'Detenida por algo de afuera',
  'en-apoyo': 'Con ayuda pedida',
  reasignada: 'De vuelta en el círculo',
  'en-revision-colectiva': 'La mira el círculo',
};

/**
 * La frase que explica el peldaño. Los dos privados vosean porque sólo los lee quien tiene la
 * tarea; los cinco públicos hablan de la tarea en tercera persona (ver la invariante 2 de la
 * cabecera). Ninguno usa la palabra «incumplimiento» en pantalla: nombra el hecho, no la falta.
 */
export const ESCALON_EXPLICACION: Readonly<Record<EscalonTarea, string>> = {
  'por-vencer':
    'Quedan menos de dos días para la fecha que se acordó. Es un recordatorio para vos, no una ' +
    'marca: no aparece en la iniciativa ni lo ve nadie más del círculo.',
  atrasada:
    'La fecha acordada ya pasó. Lo que está atrasado es la tarea, y decirlo sirve para volver a ' +
    'planearla entre todas: no queda anotado contra nadie.',
  consultada:
    'Pasaron más de tres días desde la fecha. Toca una pregunta, no un reclamo: ¿seguís con ella, ' +
    'necesitás ayuda o preferís que la tome otra persona? Las tres respuestas están bien, y esta ' +
    'pregunta sólo la ves vos.',
  bloqueada:
    'Algo de afuera la frenó y quedó avisado. El reloj de la tarea está detenido mientras dure: ' +
    'avisar nunca sale más caro que callarse.',
  'en-apoyo':
    'Se pidió ayuda y el círculo quedó convocado. El reloj de la tarea está detenido hasta que ' +
    'alguien se sume.',
  reasignada:
    'Volvió al círculo y ahora mismo no la tiene nadie. Se puede volver a ofrecer a quien tenga ' +
    'sitio para ella.',
  'en-revision-colectiva':
    'El círculo la revisa en conjunto. Lo que se mira es el acuerdo y el reparto de la carga, ' +
    'nunca a quien la llevaba: si una tarea vuelve tres veces, el problema casi siempre es cómo ' +
    'se planeó.',
};

/**
 * El color de `<Ficha>`. Ver la invariante 1 de la cabecera: `mal` no aparece en esta tabla y no
 * puede aparecer. `en-apoyo` es lo único que se pinta como movimiento (`en-curso`) porque pedir
 * ayuda es lo que el pliego quiere que pase, no lo que quiere evitar.
 */
export const ESCALON_VARIANTE: Readonly<Record<EscalonTarea, 'neutra' | 'atencion' | 'en-curso'>> =
  {
    'por-vencer': 'neutra',
    atrasada: 'atencion',
    consultada: 'atencion',
    bloqueada: 'atencion',
    'en-apoyo': 'en-curso',
    reasignada: 'neutra',
    'en-revision-colectiva': 'atencion',
  };

/**
 * Cuáles sólo los ve quien tiene la tarea. Espejo de `PELDANOS_PRIVADOS` en
 * `services/api/src/http/rutas-escalones.ts`: acá no filtra —el servidor ya lo hizo— sino que
 * habilita la frase «esto sólo lo ves vos», que es lo que convierte el peldaño 0 en un recordatorio
 * y no en una sanción.
 */
export const ESCALON_PRIVADO: Readonly<Record<EscalonTarea, boolean>> = {
  'por-vencer': true,
  atrasada: false,
  consultada: true,
  bloqueada: false,
  'en-apoyo': false,
  reasignada: false,
  'en-revision-colectiva': false,
};

/** `true` si el valor que llegó por la red es uno de los siete peldaños conocidos. */
export function esEscalonTarea(valor: unknown): valor is EscalonTarea {
  return typeof valor === 'string' && (ESCALONES_DE_TAREA as readonly string[]).includes(valor);
}

/**
 * Convierte la respuesta cruda en un índice `tareaId → peldaño`.
 *
 * Descarta en silencio las filas sin peldaño (`null`) y las que traigan un valor que esta versión
 * de la pantalla no conoce. Es deliberado: un peldaño nuevo en el servidor tiene que dejar la
 * pantalla **muda**, no rota ni inventando una palabra. Una tarea sin entrada en el índice es
 * indistinguible de una tarea sin peldaño, que es justo lo que hay que mostrar.
 */
export function escalonesPorTarea(
  respuesta: EscalonesDeIniciativa | undefined,
): ReadonlyMap<string, EscalonTarea> {
  const indice = new Map<string, EscalonTarea>();
  for (const fila of respuesta?.tareas ?? []) {
    if (esEscalonTarea(fila.escalon)) indice.set(fila.tareaId, fila.escalon);
  }
  return indice;
}

/**
 * `true` si alguna tarea llegó al techo de la escalera. Es lo único que esta pantalla agrega a
 * través de varias tareas, y a propósito devuelve un `boolean` y **no un conteo**: «tres tareas en
 * revisión» invita a comparar iniciativas o personas, y «hay algo que el círculo tiene que mirar»
 * no. ADR-0039/0040 prohíben lo primero incluso como adorno.
 */
export function hayRevisionColectiva(indice: ReadonlyMap<string, EscalonTarea>): boolean {
  for (const escalon of indice.values()) {
    if (escalon === 'en-revision-colectiva') return true;
  }
  return false;
}
