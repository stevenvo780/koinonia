/**
 * El contrato de la concentración de poder por delegación — DEL COLECTIVO, nunca de una persona.
 *
 * `docs/OBJETIVO.md` pide «visualizar concentración de poder/delegaciones» y hasta hoy no existía
 * ninguna ruta que lo expusiera. El cálculo en sí ya está hecho y probado: `normalizedHerfindahl`,
 * `gini` y `concentrationRatio` (CR1) viven en `packages/domain/src/tally/common.ts` (C.6), y el
 * recorrido de cadenas de delegación —`walkChain`, `isVigent`, `compareDelegationPriority`— vive en
 * `packages/domain/src/delegation-graph.ts` (C.2–C.4). Lo que faltaba era la composición de ambos
 * para una foto del COLECTIVO, sin atarla a ninguna votación concreta.
 *
 * # La tensión con ADR-0040, y cómo se resuelve
 *
 * ADR-0040 prohíbe la métrica de actividad individual: «Fulano concentra doce delegaciones» es
 * exactamente el panel de vigilancia que ese ADR veta. Pero una concentración que no se puede ver
 * tampoco protege de nada — es la mitad C.6 de la propia especificación del motor.
 *
 * La resolución es la misma que ya adoptó `@koinonia/metrics` para la concentración de la
 * **palabra** (`concentracion.ts` de ese paquete, que este fichero deliberadamente NO reescribe:
 * reutiliza su aritmética exacta y su disciplina de anonimato): se publica la **forma** de la
 * distribución, nunca quién ocupa cada lugar en ella.
 *
 *  - Los tres índices de C.6 (HHI normalizado, Gini, CR1) se calculan sobre el CENSO COMPLETO —cada
 *    persona que no delegó su voto cuenta como un peso propio; cada persona que sí lo delegó cuenta
 *    con peso cero **en su propio nombre**, porque su voz ya la sostiene otra persona en la cadena—,
 *    nunca sobre una lista de quién sostiene qué.
 *  - `mayorReceptor` (CR1) dice **qué fracción del censo** representa quien más concentra, nunca
 *    quién es. Es literalmente «cuánto acumula el mayor receptor sin nombrarlo», tal como lo pide
 *    el encargo.
 *  - Los `deciles` reparten el censo en diez grupos de tamaño fijo (~censo/10 personas cada uno,
 *    nunca menos) ordenados por peso sostenido, y publican cuánto peso agregado sostiene cada
 *    grupo. Un grupo de treinta personas no señala a nadie aunque adentro haya una sola persona con
 *    casi todo el peso: el número que sale es la suma del grupo, no el de la persona.
 *  - Todo el bloque de detalle se retiene por completo —ni índices ni deciles— si menos de
 *    `K_NO_SE_PUBLICA` (10) personas distintas terminan sosteniendo peso ajeno: con un puñado de
 *    receptores, hasta la FORMA de la distribución empieza a señalar a alguien. `mayorReceptor`
 *    exige además `K_MAXIMO_INDIVIDUAL` (30): es una medida de una sola posición de la distribución,
 *    el mismo riesgo que `@koinonia/metrics` ya reconoció para «cuánto puso quien más habló». Los
 *    dos umbrales se **reutilizan tal cual** de `@koinonia/metrics` — dos umbrales iguales con dos
 *    nombres es exactamente el tipo de cosa que un día deja de coincidir.
 *  - El cálculo (en `services/api/src/http/rutas-concentracion.ts`, no aquí: este fichero es sólo el
 *    contrato de transporte) pasa su salida por `sellar()` de `@koinonia/metrics` con la identidad
 *    de cada persona del censo y de cada delegación leída: si un identificador sobreviviera al
 *    cálculo por cualquier descuido futuro, `sellar()` revienta ahí mismo con
 *    `FugaDeIdentidadError`, antes de que la respuesta HTTP exista.
 *
 * # Qué NO calcula (a propósito)
 *
 * Sólo recorre delegaciones de ámbito `global` (C.1): son las únicas cuyo destino no depende de
 * ninguna decisión concreta (una delegación de `circle` o `topic` sólo tiene sentido dentro de esa
 * decisión — C.2 resuelve el ámbito contra el asunto, y aquí no hay ningún asunto). Es una lectura
 * DELIBERADAMENTE parcial: el reparto real de poder en una decisión con delegaciones de ámbito más
 * específico puede diferir de esta foto. La cabecera de la ruta HTTP repite esta limitación.
 *
 * # Sin jerga (ADR-0041)
 *
 * Ningún campo se llama `hhi`, `herfindahl`, `gini`, `cr1`, `decil` ni `percentil`. Los nombres
 * siguen la misma convención que `metricas.ts`: `reparto` para el índice normalizado (0 = repartido
 * por igual, 1 = una sola persona lo tiene todo) y `desigualdad` para Gini.
 */

import { z } from 'zod';

import type { Fraction } from '@koinonia/domain';
import type { Desglose } from '@koinonia/metrics';

import { porcentajeDeFraccion, porcentajeExacto } from './metricas.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El tipo de dominio — lo que produce el cálculo de `rutas-concentracion.ts`
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Son interfaces simples, no Zod: nada de esto viaja como entrada de un cliente, así que no hace
// falta validarlo, sólo transportarlo. `@koinonia/metrics` no tiene un paquete de concentración de
// delegación (sólo el de concentración de voz), así que —al no existir un tercer paquete «puro»
// dentro del alcance de este encargo— el vocabulario del cálculo vive aquí, junto a su transporte,
// y la aritmética misma vive en la ruta HTTP como una función pura y probada por separado. Fraction
// (bigint) se usa tal cual desde `@koinonia/domain`, sin duplicar su definición.

/** Un grupo de tamaño fijo del censo (≈censo/10 personas), y cuánto peso agregado sostiene. */
export interface BaldeDeReparto {
  /** Cuántas personas del censo caen en este grupo. Nunca identifica: es sólo un conteo. */
  readonly personas: number;
  /** Fracción del peso total delegado que sostiene este grupo en conjunto. */
  readonly participacionDelPeso: Fraction;
}

/** El detalle publicable, sólo presente cuando hay suficiente gente sosteniendo peso ajeno. */
export interface RepartoDeDelegacion {
  /** Personas distintas que hoy terminan sosteniendo el peso de al menos una cadena (la suya u otras). */
  readonly receptoresConPeso: number;
  /** Cadenas que no llegaron a nadie (ciclo, profundidad excedida o destino fuera del censo). */
  readonly personasSinAsignar: number;
  /** HHI normalizado de C.6: 0 = perfectamente repartido, 1 = una sola persona concentra todo. */
  readonly reparto: Fraction;
  /** Gini de C.6: misma lectura de extremos que `reparto`, distinta sensibilidad a la cola. */
  readonly desigualdad: Fraction;
  /** CR1 de C.6 — «la persona que más concentra representa a esta fracción del censo» — sin nombrarla. */
  readonly mayorReceptor: Desglose<Fraction>;
  /** Diez grupos de tamaño fijo, del que más peso sostiene al que menos, sin decir quién está en cada uno. */
  readonly deciles: readonly BaldeDeReparto[];
  /** `reparto ≥ 3/20 ∨ CR1 ≥ 1/20` (C.6.a, mismo umbral que el escrutinio). Marca; no invalida nada. */
  readonly alarma: boolean;
}

/** La foto completa del colectivo, en el instante en que se calculó. */
export interface InformeConcentracionDelegacion {
  /** Milisegundos desde la época, asignados por el servidor al calcular (nunca por quien pide). */
  readonly medidoEn: number;
  readonly censo: number;
  /** Cuántas personas del censo tienen hoy una delegación de ámbito global activa. Agregado, no lista. */
  readonly personasQueDelegan: number;
  readonly reparto: Desglose<RepartoDeDelegacion>;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El DTO — la forma que via HTTP, validada con Zod
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Igual que `desgloseDe` de `metricas.ts`: no se reexporta desde allá porque es un detalle interno
 * de ese fichero, así que se repite aquí en sus ocho líneas en vez de depender de algo no exportado.
 */
function desgloseDe<V extends z.ZodType>(valor: V) {
  return z.discriminatedUnion('publicado', [
    z
      .object({
        publicado: z.literal(true),
        personas: z.number().int().nonnegative(),
        grupoPequeno: z.boolean(),
        valor,
      })
      .strict(),
    z.object({ publicado: z.literal(false) }).strict(),
  ]);
}

export const baldeDeReparto = z
  .object({
    personas: z.number().int().nonnegative(),
    participacionDelPeso: porcentajeExacto,
  })
  .strict();
export type BaldeDeRepartoDto = z.infer<typeof baldeDeReparto>;

export const repartoDeDelegacion = z
  .object({
    receptoresConPeso: z.number().int().nonnegative(),
    personasSinAsignar: z.number().int().nonnegative(),
    reparto: porcentajeExacto,
    desigualdad: porcentajeExacto,
    mayorReceptor: desgloseDe(porcentajeExacto),
    deciles: z.array(baldeDeReparto),
    alarma: z.boolean(),
  })
  .strict();
export type RepartoDeDelegacionDto = z.infer<typeof repartoDeDelegacion>;

export const concentracionDelegacion = z
  .object({
    medidoEn: z.number().int().nonnegative(),
    censo: z.number().int().nonnegative(),
    personasQueDelegan: z.number().int().nonnegative(),
    reparto: desgloseDe(repartoDeDelegacion),
  })
  .strict();
export type ConcentracionDelegacion = z.infer<typeof concentracionDelegacion>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Del informe calculado al DTO — función pura, sin I/O, igual que `informeVozDto` de `metricas.ts`
// ═════════════════════════════════════════════════════════════════════════════════════════════

function desgloseADto<T, U>(
  d: Desglose<T>,
  mapear: (valor: T) => U,
):
  | {
      readonly publicado: true;
      readonly personas: number;
      readonly grupoPequeno: boolean;
      readonly valor: U;
    }
  | { readonly publicado: false } {
  if (!d.publicado) return { publicado: false };
  return {
    publicado: true,
    personas: d.personas,
    grupoPequeno: d.grupoPequeno,
    valor: mapear(d.valor),
  };
}

function baldeDeRepartoDto(b: BaldeDeReparto): BaldeDeRepartoDto {
  return {
    personas: b.personas,
    participacionDelPeso: porcentajeDeFraccion(b.participacionDelPeso),
  };
}

function repartoDeDelegacionDto(r: RepartoDeDelegacion): RepartoDeDelegacionDto {
  return {
    receptoresConPeso: r.receptoresConPeso,
    personasSinAsignar: r.personasSinAsignar,
    reparto: porcentajeDeFraccion(r.reparto),
    desigualdad: porcentajeDeFraccion(r.desigualdad),
    mayorReceptor: desgloseADto(r.mayorReceptor, porcentajeDeFraccion),
    deciles: r.deciles.map(baldeDeRepartoDto),
    alarma: r.alarma,
  };
}

/** `InformeConcentracionDelegacion` calculado por la ruta → DTO validable y transportable. */
export function concentracionDelegacionDto(
  i: InformeConcentracionDelegacion,
): ConcentracionDelegacion {
  return {
    medidoEn: i.medidoEn,
    censo: i.censo,
    personasQueDelegan: i.personasQueDelegan,
    reparto: desgloseADto(i.reparto, repartoDeDelegacionDto),
  };
}
