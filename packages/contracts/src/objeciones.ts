/**
 * Contrato de la desestimación de una objeción (B.3.a, ADR-0031, ADR-0032).
 *
 * ═══ Qué resuelve y qué no ═══
 *
 * Levantar una objeción ya viaja dentro de la papeleta de consentimiento
 * (`RespuestaPapeleta.objecion` en `services/api/src/http/service.ts`, con `postura: 'object'`). Lo
 * que faltaba era la forma de red del **único** acto que quedaba sin puerta: que un panel sorteado
 * del círculo la desestime por dos tercios y con motivación escrita publicada. Este fichero declara
 * esa forma; no toca la de levantar una objeción, que ya existe.
 *
 * ═══ Por qué no manda el panel el cliente ═══
 *
 * El panel **no es un dato que alguien escriba**: lo sortea el servidor con la semilla pública ya
 * revelada (`packages/domain/src/sortition-panel.ts`), del mismo modo que nadie manda por HTTP quién
 * salió sorteado para un comité deliberativo (ADR-0031). Por eso `desestimarObjecion` sólo lleva lo
 * que una persona humana aporta —cuántos del panel votaron desestimar, y la motivación— y la
 * respuesta (`objecionDesestimada`) es la que dice quién resultó sorteado, para que se pueda
 * verificar sin confiar en el servidor.
 *
 * ═══ Frontera con `@koinonia/domain` ═══
 *
 * `umbral` viaja como cadena («2/3»), no como el par `{num, den}` del dominio: es texto para
 * pantalla, no aritmética para volver a comparar en el cliente (el mismo principio que separa el
 * cálculo de consenso de su forma de red en `consenso.ts`).
 *
 * ═══ Lo que este contrato NO resuelve, a propósito ═══
 *
 * `packages/contracts/src/index.ts` todavía no reexporta este fichero (esa línea está fuera de mi
 * alcance: la consigna la reserva a un integrador posterior). Hasta que se agregue
 * `export * from './objeciones.js';`, importar estos tipos desde `@koinonia/contracts` no resuelve;
 * `services/api/src/http/rutas-objeciones.ts` por eso valida su propio cuerpo de petición con un
 * esquema local en vez de depender de este fichero, exactamente la misma situación que documentó
 * `consenso.ts` en su momento.
 */

import { z } from 'zod';

import { instantMs, opaqueId, requestId } from './ids.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Escritura
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Lo que publica quien reporta el pronunciamiento del panel sorteado.
 *
 * `votos` es cuántas de las personas del panel votaron desestimar (de un total que ya se sabe: el
 * tamaño del panel, fijado por la configuración de la decisión). La motivación es obligatoria y no
 * puede quedar vacía tras normalizar espacios: B.3.a exige «motivación escrita publicada», y un
 * texto en blanco no es una motivación, es la ausencia de una disfrazada de campo lleno.
 */
export const desestimarObjecion = z
  .object({
    requestId,
    votos: z.number().int().nonnegative(),
    motivacion: z
      .string()
      .trim()
      .min(
        20,
        'La motivación tiene que poder leerse y entenderse: una frase completa, no una palabra.',
      ),
  })
  .strict();
export type DesestimarObjecion = z.infer<typeof desestimarObjecion>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lectura
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * El resultado publicado: quién salió sorteado, cuántos votaron desestimar y con qué motivación.
 *
 * `panel` viaja completo (no sólo el conteo) porque ADR-0031 exige que el sorteo sea verificable:
 * cualquiera del círculo recalcula su propio ticket con la semilla pública y comprueba si debía
 * salir. Publicar sólo «3 personas sortearon» no permite esa comprobación.
 */
export const objecionDesestimada = z.object({
  decisionId: opaqueId,
  objectionId: opaqueId,
  panel: z.array(opaqueId),
  tamanoPanel: z.number().int().positive(),
  votos: z.number().int().nonnegative(),
  /** Fracción exigida para desestimar, en palabras («2/3»). No es aritmética para recomparar. */
  umbral: z.string(),
  motivacion: z.string(),
  desestimadaEn: instantMs,
});
export type ObjecionDesestimada = z.infer<typeof objecionDesestimada>;
