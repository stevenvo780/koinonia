/**
 * Las cinco métricas de salud democrática, servidas por HTTP — el hueco que este encargo cierra.
 *
 * `@koinonia/metrics` tiene 1.830 líneas y 92 pruebas y hasta hoy no lo llamaba nadie: ninguna ruta,
 * ningún contrato. `docs/PRODUCT.md` §4 promete que la portada muestre «acuerdos cumplidos y
 * vencidos, con su serie», y `03-deliberativa-sistemas-antipatrones.md` §6 pide que las cinco se
 * calculen semanalmente y se muestren «con su serie histórica: el nivel importa menos que la
 * dirección». Este fichero añade dos rutas nuevas; no toca ninguna de las 65 que ya viven en
 * `app.ts`.
 *
 * ═══ Qué ventana usa cada ruta, y por qué ═══
 *
 * §6 fija 30 días explícitamente para la voz y para la cobertura. Para acuerdos, rotación y
 * deliberación no fija un número; en vez de inventar uno distinto para cada una, `GET /metricas/salud`
 * usa **la misma** `VENTANA_DE_30_DIAS_MS` para las cinco: es la que el propio paquete ya expone y
 * documenta, y un panel con cinco ventanas distintas es un panel que nadie puede leer junto (§6 pide
 * exactamente lo contrario: mirarlas juntas). Si con el uso real se ve que el cumplimiento de acuerdos
 * necesita una ventana más larga —tiene sentido: los acuerdos vencen con menos frecuencia que se
 * habla—, es un cambio de un parámetro en este fichero, no de arquitectura.
 *
 * La **rotación** compara la ventana vigente contra la inmediatamente anterior, del mismo tamaño y
 * contigua: es la lectura más simple de «el período anterior» de §6 y no requiere que quien llama
 * declare un segundo rango.
 *
 * ═══ Qué se expone y qué no (siguiendo la decisión de `packages/contracts/src/metricas.ts`) ═══
 *
 * Todo lo que `@koinonia/metrics` decide publicar sale tal cual, incluido el cruce semestre × jornada
 * de la cobertura: el paquete ya implementa el k-anonimato de RA-10 en tres capas independientes y
 * probadas, y este fichero no añade un segundo umbral por encima. Ver la cabecera de `metricas.ts`
 * para el razonamiento completo.
 *
 * ═══ Nota de integración ═══
 *
 * `packages/contracts/src/index.ts` ya reexporta `metricas.ts` y `app.ts` ya llama a
 * `registrarRutasDeMetricas` (agente integrador posterior a este fichero), así que el contrato se
 * importa por `@koinonia/contracts` como el resto de las rutas. Sigue pendiente lo de abajo: los
 * cinco `leerEntradaX` son la interfaz, no la implementación — no hay ninguna consulta a PostgreSQL
 * porque ninguna de las cinco proyecciones (acuerdos con su reloj detenido, aportes de habla, padrón
 * con sus cuatro ejes, deliberaciones y votaciones) existe todavía como lectura en `service.ts`. Al
 * implementarlas, se recomienda `prescripcionMs: ESCALATION_PRESCRIPTION_MS` de `@koinonia/domain`
 * (`packages/domain/src/evaluation/types.ts`): es la misma «dos semestres» del ADR-0040, ya escrita
 * una vez, y dos constantes iguales con dos nombres es una que un día deja de coincidir.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  consultaSerieAcuerdos,
  informeSaludDto,
  serieDeAcuerdosDto,
  type ConsultaSerieAcuerdos,
  type InformeSalud,
  type SerieDeAcuerdos,
} from '@koinonia/contracts';
import {
  informeDeAcuerdos,
  informeDeCobertura,
  informeDeDeliberacion,
  informeDeRotacion,
  informeDeVoz,
  VENTANA_DE_30_DIAS_MS,
  type EntradaAcuerdos,
  type EntradaCobertura,
  type EntradaDeliberacion,
  type EntradaRotacion,
  type EntradaVoz,
  type Instante,
  type Ventana,
} from '@koinonia/metrics';

import type { ClockPort } from './ports.js';

/**
 * Exactamente lo que estas rutas necesitan del ámbito de `buildApp`: nada más.
 *
 * Cada `leerEntradaX` recibe la ventana ya decidida por la ruta y devuelve la entrada tal como la
 * pide `@koinonia/metrics` — la proyección (leer acuerdos, aportes, padrón…) es responsabilidad de
 * quien implemente este contexto, no de este fichero, que sólo orquesta ventanas y formatea salida.
 */
export interface ContextoMetricas {
  readonly clock: ClockPort;
  readonly leerEntradaAcuerdos: (ventana: Ventana, instante: Instante) => Promise<EntradaAcuerdos>;
  readonly leerEntradaVoz: (ventana: Ventana) => Promise<EntradaVoz>;
  readonly leerEntradaCobertura: (ventana: Ventana) => Promise<EntradaCobertura>;
  readonly leerEntradaRotacion: (
    periodoAnterior: Ventana,
    periodoActual: Ventana,
  ) => Promise<EntradaRotacion>;
  readonly leerEntradaDeliberacion: (ventana: Ventana) => Promise<EntradaDeliberacion>;
}

/** Cuántos puntos trae la serie cuando quien llama no especifica `puntos`: un año a 30 días cada uno. */
const PUNTOS_POR_DEFECTO = 12;

/** La ventana de `duracionMs` que termina exactamente en `hasta`. */
function ventanaTerminadaEn(hasta: Instante, duracionMs: number): Ventana {
  return { desde: hasta - duracionMs, hasta };
}

/**
 * `cuantas` ventanas sucesivas y contiguas de `duracionMs`, la más reciente terminando en `hasta`.
 *
 * Devuelve de la más vieja a la más nueva: es el orden en que se lee un eje de tiempo, y así el
 * cliente no tiene que invertir el arreglo para pintar un gráfico.
 */
export function generarVentanas(
  hasta: Instante,
  duracionMs: number,
  cuantas: number,
): readonly Ventana[] {
  const ventanas: Ventana[] = [];
  for (let i = cuantas - 1; i >= 0; i -= 1) {
    ventanas.push(ventanaTerminadaEn(hasta - i * duracionMs, duracionMs));
  }
  return ventanas;
}

/**
 * Registra las rutas de este fichero sobre `app`. No añade `onRequest` ni `setErrorHandler` propios:
 * hereda el de `buildApp` (incluida la traducción de errores a español), así que sólo tiene sentido
 * llamarla después de que `buildApp` los instale — igual que el resto de las rutas de `app.ts`.
 *
 * Ninguna de las dos rutas exige sesión: son las mismas cinco cifras para las ~300 personas, nunca
 * una por individuo, así que no hay nada que una sesión deba proteger.
 */
export function registrarRutasDeMetricas(app: FastifyInstance, ctx: ContextoMetricas): void {
  // GET /metricas/salud
  //   Exige: nada.
  //   Devuelve: InformeSalud — las cinco métricas sobre la misma ventana de 30 días terminada ahora.
  //   Ejemplo: fetch('/metricas/salud').then(r => r.json()) → { acuerdos, voz, cobertura, rotacion, deliberacion }
  app.get('/metricas/salud', async (request): Promise<InformeSalud> => {
    z.object({}).strict().parse(request.query);

    const hasta = ctx.clock.now();
    const ventana = ventanaTerminadaEn(hasta, VENTANA_DE_30_DIAS_MS);
    const periodoAnterior = ventanaTerminadaEn(ventana.desde, VENTANA_DE_30_DIAS_MS);

    const [acuerdos, voz, cobertura, rotacion, deliberacion] = await Promise.all([
      ctx.leerEntradaAcuerdos(ventana, hasta),
      ctx.leerEntradaVoz(ventana),
      ctx.leerEntradaCobertura(ventana),
      ctx.leerEntradaRotacion(periodoAnterior, ventana),
      ctx.leerEntradaDeliberacion(ventana),
    ]);

    return informeSaludDto({
      acuerdos: informeDeAcuerdos(acuerdos),
      voz: informeDeVoz(voz),
      cobertura: informeDeCobertura(cobertura),
      rotacion: informeDeRotacion(rotacion),
      deliberacion: informeDeDeliberacion(deliberacion),
    });
  });

  // GET /metricas/acuerdos/serie?puntos=N
  //   Exige: nada. `puntos` es opcional, entero entre 1 y 52 (por defecto 12).
  //   Devuelve: SerieDeAcuerdos — la métrica maestra de §6 sobre `puntos` ventanas sucesivas de 30
  //   días, la que docs/PRODUCT.md §4 promete para la portada («acuerdos cumplidos y vencidos, con
  //   su serie»).
  //   Ejemplo: fetch('/metricas/acuerdos/serie?puntos=6').then(r => r.json()) → { generadaEn, duracionDePuntoMs, puntos: [...] }
  app.get('/metricas/acuerdos/serie', async (request): Promise<SerieDeAcuerdos> => {
    const { puntos }: ConsultaSerieAcuerdos = consultaSerieAcuerdos.parse(request.query);
    const cuantos = puntos ?? PUNTOS_POR_DEFECTO;

    const hasta = ctx.clock.now();
    const ventanas = generarVentanas(hasta, VENTANA_DE_30_DIAS_MS, cuantos);

    const informes = await Promise.all(
      ventanas.map(async (v) => informeDeAcuerdos(await ctx.leerEntradaAcuerdos(v, v.hasta))),
    );

    return serieDeAcuerdosDto(informes, VENTANA_DE_30_DIAS_MS, hasta);
  });
}
