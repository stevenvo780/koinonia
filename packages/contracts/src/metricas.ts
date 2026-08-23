/**
 * El contrato de las cinco métricas de salud democrática.
 *
 * `@koinonia/metrics` está terminado, tiene 92 pruebas y hasta hoy no lo llamaba nadie: no tenía
 * ruta HTTP, ni contrato, ni pantalla. `docs/PRODUCT.md` §4 promete que la portada muestre «acuerdos
 * cumplidos y vencidos, con su serie», y `03-deliberativa-sistemas-antipatrones.md` §6 define las
 * cinco y pide que las cinco se muestren «con su serie histórica: el nivel importa menos que la
 * dirección». Este fichero es la traducción a Zod de lo que ese paquete ya calcula.
 *
 * # Qué se expone y por qué (y qué NO)
 *
 * `@koinonia/metrics` no es un cálculo cualquiera: su propio `types.ts` implementa el ADR-0040 en
 * tres capas —el compilador, el sellado en tiempo de ejecución y la ausencia de identidad en la
 * entrada— y el k-anonimato de RA-10 (por debajo de 10 personas no se publica un desglose; entre 10
 * y 29 se publica con aviso). Ese es exactamente el problema que este encargo pide resolver para la
 * cobertura por estrato («puede volverse identificadora si un estrato tiene tres personas»): **el
 * paquete ya lo resuelve, probado, y no hay razón para reinventar un segundo umbral aquí**. Por eso
 * este contrato expone tal cual todo lo que `InformeSalud` decide publicar —incluido el cruce
 * semestre × jornada—, confiando en esa barrera y no en el buen juicio de quien escriba la pantalla.
 *
 * Lo que este contrato **añade** encima del paquete es sólo forma de transporte:
 *
 *  - Las `Fraction` del dominio (`{ num: bigint, den: bigint }`) no viajan por JSON —`JSON.stringify`
 *    revienta con un `bigint`—, así que se transportan como `{ numerador, denominador, texto }` con
 *    los dos primeros ya convertidos a `number` (los conteos de esta comunidad son de cientos, muy
 *    por debajo de `Number.MAX_SAFE_INTEGER`) y `texto` ya formateado con `comoPorcentaje`/`comoRazon`
 *    de `@koinonia/metrics`, para que dos pantallas no formateen distinto la misma cifra.
 *  - Se distingue **porcentaje** de **razón** con dos esquemas de nombre distinto en vez de un campo
 *    `unidad`: `deliberacion.razon` puede pasar de 1 (tres conversaciones por cada votación) y un
 *    campo llamado igual que uno acotado a [0,1] es la clase de ambigüedad que hace que una pantalla
 *    salga mal.
 *
 * # Sin jerga (ADR-0041)
 *
 * Ningún campo se llama `hhi`, `herfindahl`, `decil` ni `percentil`; los nombres son los que ya fija
 * `@koinonia/metrics/textos.ts`. Los textos completos de pantalla siguen viviendo allá — este
 * contrato transporta números y las cadenas ya formateadas por `comoPorcentaje`/`comoRazon`, no los
 * párrafos explicativos, que la pantalla arma con `TEXTOS`.
 *
 * # Ninguna salida de aquí decide nada
 *
 * Igual que en `@koinonia/metrics`: estas cinco cifras son diagnóstico, no regla de decisión. Quien
 * las consuma no debe ponderar votos con ellas ni condicionar la apertura o el cierre de una
 * decisión a su valor.
 */

import { z } from 'zod';

import type { Fraction } from '@koinonia/domain';
import { comoPorcentaje, comoRazon } from '@koinonia/metrics';
// Espacio de nombres, y no importes con nombre: `@koinonia/metrics` exporta `CuentaDeAcuerdos`,
// `InformeVoz`, `Medida`… los mismos nombres que este fichero declara para el DTO de salida. Un
// `import type * as` evita 18 alias manuales y dos cosas que se llaman igual y no son lo mismo.
import type * as Metrica from '@koinonia/metrics';

import { instantMs } from './ids.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Piezas comunes
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Ventana temporal `[desde, hasta)` de un informe. Milisegundos desde la época. */
export const ventanaMetrica = z
  .object({
    desde: instantMs,
    hasta: instantMs,
  })
  .strict();
export type VentanaMetrica = z.infer<typeof ventanaMetrica>;

const numerador = z.number().int().nonnegative();
const denominador = z.number().int().positive();

/**
 * Una proporción exacta, acotada entre 0 y 1, mostrada como porcentaje.
 *
 * `numerador`/`denominador` viajan sin reducir —igual que la `Fraction` de origen—: «12 de 40» y
 * «120 de 400» son el mismo porcentaje y no la misma noticia, y quien lee la serie necesita poder
 * distinguirlas. `texto` es el porcentaje ya formateado (`comoPorcentaje`, trunca hacia cero): nunca
 * se recalcula en la pantalla para que «49,9 %» no se redondee un día a «50 %».
 */
export const porcentajeExacto = z.object({ numerador, denominador, texto: z.string() }).strict();
export type PorcentajeExacto = z.infer<typeof porcentajeExacto>;

/**
 * Una razón exacta que **puede pasar de 1** (p. ej. deliberaciones por cada votación). Se formatea
 * con `comoRazon`, nunca como porcentaje: un «300 %» en pantalla se lee como error, no como «tres».
 */
export const razonExacta = z.object({ numerador, denominador, texto: z.string() }).strict();
export type RazonExacta = z.infer<typeof razonExacta>;

/** Un porcentaje que puede no existir todavía («cero acuerdos vencidos» no es «0 % de cumplimiento»). */
export const medidaPorcentaje = z.discriminatedUnion('hay', [
  z.object({ hay: z.literal(true), numerador, denominador, texto: z.string() }).strict(),
  z.object({ hay: z.literal(false) }).strict(),
]);
export type MedidaPorcentaje = z.infer<typeof medidaPorcentaje>;

/** Una razón que puede no existir todavía (sin votaciones en la ventana, no hay razón que calcular). */
export const medidaRazon = z.discriminatedUnion('hay', [
  z.object({ hay: z.literal(true), numerador, denominador, texto: z.string() }).strict(),
  z.object({ hay: z.literal(false) }).strict(),
]);
export type MedidaRazon = z.infer<typeof medidaRazon>;

/**
 * Un desglose por grupo: publicado (con aviso si el grupo es chico) o retenido por pocas personas
 * (RA-10 / `K_NO_SE_PUBLICA` de `@koinonia/metrics`). Cuando se retiene **no se dice cuánta gente
 * hay**: en un cruce, «este grupo tiene 3 personas» ya identifica a esas tres.
 */
function desgloseDe<V extends z.ZodType>(valor: V) {
  return z.discriminatedUnion('publicado', [
    z
      .object({
        publicado: z.literal(true),
        personas: z.number().int().nonnegative(),
        /** El grupo tiene menos de 30 personas: el dato vale, pero se mueve mucho con muy poco. */
        grupoPequeno: z.boolean(),
        valor,
      })
      .strict(),
    z.object({ publicado: z.literal(false) }).strict(),
  ]);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 1 — Acuerdos: cumplimiento y deuda
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const cuentaDeAcuerdos = z
  .object({
    vencianEnLaVentana: z.number().int().nonnegative(),
    cumplidos: z.number().int().nonnegative(),
    cumplidosTarde: z.number().int().nonnegative(),
    /** Vencidos, sin cerrar, sin reloj detenido y sin prescribir. */
    deuda: z.number().int().nonnegative(),
    /** Con bloqueo declarado o petición de ayuda: fuera del cociente (ADR-0040). */
    conRelojDetenido: z.number().int().nonnegative(),
    /** Vencidos hace más de dos semestres: salen de la deuda. */
    prescritos: z.number().int().nonnegative(),
    enCurso: z.number().int().nonnegative(),
    cumplimiento: medidaPorcentaje,
  })
  .strict();
export type CuentaDeAcuerdos = z.infer<typeof cuentaDeAcuerdos>;

export const cumplimientoDeCirculo = z
  .object({ circulo: z.string(), desglose: desgloseDe(cuentaDeAcuerdos) })
  .strict();
export type CumplimientoDeCirculo = z.infer<typeof cumplimientoDeCirculo>;

/** Por tipo de tarea nunca se retiene: un tipo de tarea no es un grupo de personas. */
export const cumplimientoDeTipo = z.object({ tipo: z.string(), cuenta: cuentaDeAcuerdos }).strict();
export type CumplimientoDeTipo = z.infer<typeof cumplimientoDeTipo>;

export const informeAcuerdos = z
  .object({
    ventana: ventanaMetrica,
    total: cuentaDeAcuerdos,
    /** §6: «bajo 0,5 sostenido, la plataforma es teatro». */
    bajoLaMitad: z.boolean(),
    porCirculo: z.array(cumplimientoDeCirculo),
    porTipo: z.array(cumplimientoDeTipo),
    circulosNoPublicados: z.number().int().nonnegative(),
  })
  .strict();
export type InformeAcuerdos = z.infer<typeof informeAcuerdos>;

/**
 * La serie histórica que `docs/PRODUCT.md` §4 promete en la portada: la misma métrica, calculada
 * sobre ventanas sucesivas de igual duración. `puntos[0]` es la más antigua; la última es la vigente.
 */
export const serieDeAcuerdos = z
  .object({
    generadaEn: instantMs,
    duracionDePuntoMs: z.number().int().positive(),
    puntos: z.array(informeAcuerdos),
  })
  .strict();
export type SerieDeAcuerdos = z.infer<typeof serieDeAcuerdos>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 2 — Qué tan repartida está la voz (rótulo fijado por la tabla del ADR-0041; no se cambia sin ADR)
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const repartoDeVoz = z
  .object({
    /** Cuántas personas distintas hablaron en la ventana. No es un desglose: es un conteo agregado. */
    personasQueHablaron: z.number().int().nonnegative(),
    /** El índice normalizado (0 = todos por igual, 1 = una sola persona). Alimenta la alarma. */
    reparto: porcentajeExacto,
    /** El mismo índice sin normalizar, para que la cifra sea recomputable. */
    repartoBruto: porcentajeExacto,
    /** Cuánto del total puso quien más habló, sobre el censo. Exige 30 personas hablando, no 10. */
    mayorParticipacion: desgloseDe(porcentajeExacto),
    /** §6 / C.6.a: alarma en 3/20. No invalida nada de lo decidido: marca. */
    alarma: z.boolean(),
  })
  .strict();
export type RepartoDeVoz = z.infer<typeof repartoDeVoz>;

export const informeVoz = z
  .object({
    ventana: ventanaMetrica,
    censo: z.number().int().nonnegative(),
    aportesContados: z.number().int().nonnegative(),
    reparto: desgloseDe(repartoDeVoz),
  })
  .strict();
export type InformeVoz = z.infer<typeof informeVoz>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 3 — Cobertura del padrón por estrato
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const coberturaDeGrupo = z
  .object({
    conAlMenosUnActo: z.number().int().nonnegative(),
    cobertura: porcentajeExacto,
  })
  .strict();
export type CoberturaDeGrupo = z.infer<typeof coberturaDeGrupo>;

/** Los cuatro ejes de C11. El género no es uno: es dato sensible del art. 5 de la Ley 1581. */
export const ejeEstrato = z.enum(['semestre', 'jornada', 'nivel', 'participacionPrevia']);
export type EjeEstrato = z.infer<typeof ejeEstrato>;

export const celdaDeEje = z
  .object({ eje: ejeEstrato, valor: z.string(), desglose: desgloseDe(coberturaDeGrupo) })
  .strict();
export type CeldaDeEje = z.infer<typeof celdaDeEje>;

/** El cruce semestre × jornada de §6: dos ejes, el máximo que C11 admite cruzar. */
export const celdaDeCruce = z
  .object({
    semestre: z.string(),
    jornada: z.string(),
    desglose: desgloseDe(coberturaDeGrupo),
  })
  .strict();
export type CeldaDeCruce = z.infer<typeof celdaDeCruce>;

export const informeCobertura = z
  .object({
    ventana: ventanaMetrica,
    padron: z.number().int().nonnegative(),
    global: desgloseDe(coberturaDeGrupo),
    porEje: z.array(celdaDeEje),
    cruceSemestreJornada: z.array(celdaDeCruce),
    /** Distancia entre el grupo al que más llega y el grupo al que menos, dentro de un mismo eje. */
    brecha: medidaPorcentaje,
    celdasNoPublicadas: z.number().int().nonnegative(),
  })
  .strict();
export type InformeCobertura = z.infer<typeof informeCobertura>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 4 — Rotación del núcleo activo
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const cambioDelNucleo = z
  .object({
    nucleoAnterior: z.number().int().nonnegative(),
    nucleoActual: z.number().int().nonnegative(),
    salieron: z.number().int().nonnegative(),
    rotacion: porcentajeExacto,
    personasNuevas: z.number().int().nonnegative(),
    proporcionDePersonasNuevas: porcentajeExacto,
    /**
     * A partir de cuántos aportes se pertenecía al núcleo, en cada período. Se publica para que la
     * cifra sea recomputable: el núcleo es un corte sobre una distribución, nunca un ranking.
     */
    corteAnterior: z.number().int().nonnegative(),
    corteActual: z.number().int().nonnegative(),
  })
  .strict();
export type CambioDelNucleo = z.infer<typeof cambioDelNucleo>;

export const informeRotacion = z
  .object({
    periodoAnterior: ventanaMetrica,
    periodoActual: ventanaMetrica,
    participantesAnteriores: z.number().int().nonnegative(),
    participantesActuales: z.number().int().nonnegative(),
    cambio: desgloseDe(cambioDelNucleo),
  })
  .strict();
export type InformeRotacion = z.infer<typeof informeRotacion>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 5 — Razón deliberación/votación, con la tasa de unanimidad
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const informeDeliberacion = z
  .object({
    ventana: ventanaMetrica,
    deliberaciones: z.number().int().nonnegative(),
    intervenciones: z.number().int().nonnegative(),
    votaciones: z.number().int().nonnegative(),
    votacionesUnanimes: z.number().int().nonnegative(),
    votacionesSinDeliberacionPrevia: z.number().int().nonnegative(),
    /** `deliberaciones / votaciones`. Puede pasar de 1: no es una proporción, es una razón. */
    razon: medidaRazon,
    intervencionesPorVotacion: medidaRazon,
    /** `unánimes / votaciones`. Alta no es buena noticia: puede ser que el disenso se haya ido. */
    unanimidad: medidaPorcentaje,
  })
  .strict();
export type InformeDeliberacion = z.infer<typeof informeDeliberacion>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El panel completo
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Las cinco métricas sobre la misma ventana. §6 pide mirarlas juntas: cada una tapa el punto ciego
 * de las demás — la rotación es lo que delata a una asamblea capturada cuando el resto está en verde.
 */
export const informeSalud = z
  .object({
    acuerdos: informeAcuerdos,
    voz: informeVoz,
    cobertura: informeCobertura,
    rotacion: informeRotacion,
    deliberacion: informeDeliberacion,
  })
  .strict();
export type InformeSalud = z.infer<typeof informeSalud>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Del informe de `@koinonia/metrics` al DTO transportable
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Funciones puras, sin I/O: reciben lo que devuelven `informeDeAcuerdos`, `informeDeVoz`… de
// `@koinonia/metrics` (tipado `Agregado<…>`, que en este punto ya es indistinguible de su tipo base
// porque ninguno de esos informes puede transportar una identidad) y devuelven la forma de arriba.
// Viven aquí y no en `services/api` para que exista **una sola** traducción entre las dos formas: la
// ruta HTTP sólo llama a `informeDeX` y después a `informeXDto`, sin reescribir la conversión.

/** Convierte una `Fraction` exacta en su forma transportable, mostrada como porcentaje. */
export function porcentajeDeFraccion(f: Fraction): PorcentajeExacto {
  return { numerador: Number(f.num), denominador: Number(f.den), texto: comoPorcentaje(f) };
}

/** Igual, pero mostrada como razón (puede pasar de 1; nunca se lee como porcentaje). */
export function razonDeFraccion(f: Fraction): RazonExacta {
  return { numerador: Number(f.num), denominador: Number(f.den), texto: comoRazon(f) };
}

function medidaPorcentajeDe(m: Metrica.Medida): MedidaPorcentaje {
  return m.hay ? { hay: true, ...porcentajeDeFraccion(m.valor) } : { hay: false };
}

function medidaRazonDe(m: Metrica.Medida): MedidaRazon {
  return m.hay ? { hay: true, ...razonDeFraccion(m.valor) } : { hay: false };
}

/** Traslada un `Desglose<T>` del paquete a su DTO, aplicando `mapear` sólo si se publicó. */
function desgloseA<T, U>(
  d: Metrica.Desglose<T>,
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

function cuentaDeAcuerdosDto(c: Metrica.CuentaDeAcuerdos): CuentaDeAcuerdos {
  return {
    vencianEnLaVentana: c.vencianEnLaVentana,
    cumplidos: c.cumplidos,
    cumplidosTarde: c.cumplidosTarde,
    deuda: c.deuda,
    conRelojDetenido: c.conRelojDetenido,
    prescritos: c.prescritos,
    enCurso: c.enCurso,
    cumplimiento: medidaPorcentajeDe(c.cumplimiento),
  };
}

/** `InformeAcuerdos` de `@koinonia/metrics` → DTO. Úsase tanto para el panel como para cada punto de la serie. */
export function informeAcuerdosDto(i: Metrica.InformeAcuerdos): InformeAcuerdos {
  return {
    ventana: i.ventana,
    total: cuentaDeAcuerdosDto(i.total),
    bajoLaMitad: i.bajoLaMitad,
    porCirculo: i.porCirculo.map((p) => ({
      circulo: p.circulo,
      desglose: desgloseA(p.desglose, cuentaDeAcuerdosDto),
    })),
    porTipo: i.porTipo.map((p) => ({ tipo: p.tipo, cuenta: cuentaDeAcuerdosDto(p.cuenta) })),
    circulosNoPublicados: i.circulosNoPublicados,
  };
}

/** Empaqueta una lista de puntos ya calculados (uno por ventana) en la serie que pide PRODUCT §4. */
export function serieDeAcuerdosDto(
  puntos: readonly Metrica.InformeAcuerdos[],
  duracionDePuntoMs: number,
  generadaEn: number,
): SerieDeAcuerdos {
  return { generadaEn, duracionDePuntoMs, puntos: puntos.map(informeAcuerdosDto) };
}

function repartoDeVozDto(r: Metrica.RepartoDeVoz): RepartoDeVoz {
  return {
    personasQueHablaron: r.personasQueHablaron,
    reparto: porcentajeDeFraccion(r.reparto),
    repartoBruto: porcentajeDeFraccion(r.repartoBruto),
    mayorParticipacion: desgloseA(r.mayorParticipacion, porcentajeDeFraccion),
    alarma: r.alarma,
  };
}

export function informeVozDto(i: Metrica.InformeVoz): InformeVoz {
  return {
    ventana: i.ventana,
    censo: i.censo,
    aportesContados: i.aportesContados,
    reparto: desgloseA(i.reparto, repartoDeVozDto),
  };
}

function coberturaDeGrupoDto(c: Metrica.CoberturaDeGrupo): CoberturaDeGrupo {
  return { conAlMenosUnActo: c.conAlMenosUnActo, cobertura: porcentajeDeFraccion(c.cobertura) };
}

export function informeCoberturaDto(i: Metrica.InformeCobertura): InformeCobertura {
  return {
    ventana: i.ventana,
    padron: i.padron,
    global: desgloseA(i.global, coberturaDeGrupoDto),
    porEje: i.porEje.map((c) => ({
      eje: c.eje,
      valor: c.valor,
      desglose: desgloseA(c.desglose, coberturaDeGrupoDto),
    })),
    cruceSemestreJornada: i.cruceSemestreJornada.map((c) => ({
      semestre: c.semestre,
      jornada: c.jornada,
      desglose: desgloseA(c.desglose, coberturaDeGrupoDto),
    })),
    brecha: medidaPorcentajeDe(i.brecha),
    celdasNoPublicadas: i.celdasNoPublicadas,
  };
}

function cambioDelNucleoDto(c: Metrica.CambioDelNucleo): CambioDelNucleo {
  return {
    nucleoAnterior: c.nucleoAnterior,
    nucleoActual: c.nucleoActual,
    salieron: c.salieron,
    rotacion: porcentajeDeFraccion(c.rotacion),
    personasNuevas: c.personasNuevas,
    proporcionDePersonasNuevas: porcentajeDeFraccion(c.proporcionDePersonasNuevas),
    corteAnterior: c.corteAnterior,
    corteActual: c.corteActual,
  };
}

export function informeRotacionDto(i: Metrica.InformeRotacion): InformeRotacion {
  return {
    periodoAnterior: i.periodoAnterior,
    periodoActual: i.periodoActual,
    participantesAnteriores: i.participantesAnteriores,
    participantesActuales: i.participantesActuales,
    cambio: desgloseA(i.cambio, cambioDelNucleoDto),
  };
}

export function informeDeliberacionDto(i: Metrica.InformeDeliberacion): InformeDeliberacion {
  return {
    ventana: i.ventana,
    deliberaciones: i.deliberaciones,
    intervenciones: i.intervenciones,
    votaciones: i.votaciones,
    votacionesUnanimes: i.votacionesUnanimes,
    votacionesSinDeliberacionPrevia: i.votacionesSinDeliberacionPrevia,
    razon: medidaRazonDe(i.razon),
    intervencionesPorVotacion: medidaRazonDe(i.intervencionesPorVotacion),
    unanimidad: medidaPorcentajeDe(i.unanimidad),
  };
}

/** El panel completo: las cinco métricas de `@koinonia/metrics`, traducidas a la vez. */
export function informeSaludDto(i: Metrica.InformeSalud): InformeSalud {
  return {
    acuerdos: informeAcuerdosDto(i.acuerdos),
    voz: informeVozDto(i.voz),
    cobertura: informeCoberturaDto(i.cobertura),
    rotacion: informeRotacionDto(i.rotacion),
    deliberacion: informeDeliberacionDto(i.deliberacion),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Parámetros de consulta
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** `GET /metricas/acuerdos/serie`. Sin parámetro, la ruta decide un valor por defecto razonable. */
export const consultaSerieAcuerdos = z
  .object({
    /** Cuántos puntos de la serie devolver. Acotado: cada punto cuesta una consulta más. */
    puntos: z.coerce.number().int().min(1).max(52).optional(),
  })
  .strict();
export type ConsultaSerieAcuerdos = z.infer<typeof consultaSerieAcuerdos>;
