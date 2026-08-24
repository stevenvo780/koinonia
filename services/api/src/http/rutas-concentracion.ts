/**
 * Ruta que expone la concentración de poder por delegación — DEL COLECTIVO.
 *
 * El pliego (`docs/OBJETIVO.md`) pide «visualizar concentración de poder/delegaciones» y no había
 * ninguna ruta que lo sirviera, aunque el cálculo ya estaba hecho y probado en el dominio:
 * `normalizedHerfindahl`, `gini` y `concentrationRatio` (C.6, `packages/domain/src/tally/common.ts`)
 * y el recorrido de cadenas de delegación (`walkChain`, C.2–C.4,
 * `packages/domain/src/delegation-graph.ts`). Este fichero compone ambos para una foto del colectivo
 * que no depende de ninguna votación abierta.
 *
 * El contrato completo —qué se publica, qué se retiene y por qué, con la tensión ADR-0040 resuelta
 * a fondo— está documentado en `packages/contracts/src/concentracion.ts`. Acá sólo el resumen: se
 * publica la FORMA de la distribución (índices normalizados, deciles de tamaño fijo, cuánta fracción
 * del censo sostiene quien más concentra), nunca una lista de quién sostiene qué. La salida pasa por
 * `sellar()` de `@koinonia/metrics` con la identidad de cada persona leída: si algún identificador
 * sobreviviera al cálculo, la llamada revienta con `FugaDeIdentidadError` antes de que exista
 * respuesta HTTP.
 *
 * ═══ Por qué sólo delegaciones de ámbito GLOBAL ═══
 *
 * Una delegación de ámbito `circle` o `topic` sólo tiene sentido resuelta contra una decisión
 * concreta (C.2: el ámbito se resuelve contra `circleId`/`topics` del asunto). Esta ruta no vive
 * dentro de ninguna decisión — es una foto del colectivo en general—, así que sólo tiene sentido
 * recorrer las delegaciones cuyo destino NO depende de ningún asunto: las de ámbito `global`. Es una
 * lectura deliberadamente parcial: el reparto real de poder en una decisión concreta con
 * delegaciones más específicas puede diferir de esta foto. Documentado también en
 * `packages/contracts/src/concentracion.ts`.
 *
 * ═══ Cómo se integra ═══
 *
 * Este fichero **no toca `app.ts`**. Exporta `registrarRutasDeConcentracion(app, ctx)`, que un
 * agente integrador llama desde dentro de `buildApp`, igual que ya hace con
 * `registrarRutasDeMetricas`. Dos piezas quedan deliberadamente fuera de este encargo:
 *
 *  1. `packages/contracts/src/index.ts` no reexporta `concentracion.ts` todavía — una línea,
 *     fuera de mi alcance (la consigna prohíbe tocar ese fichero).
 *  2. `ContextoConcentracion.leerCenso`/`leerDelegacionesGlobales` son la interfaz, no la
 *     implementación: ninguna consulta a PostgreSQL existe todavía aquí, igual que
 *     `rutas-metricas.ts` deja pendientes sus cinco `leerEntradaX`. Quien integre decide de dónde
 *     sale el censo activo y el log de delegaciones (probablemente replayando el mismo agregado que
 *     ya usa el motor de escrutinio al resolver delegaciones dentro de una decisión).
 */

import {
  compareDelegationPriority,
  gini,
  HIGH_CONCENTRATION_CR1,
  HIGH_CONCENTRATION_HHI,
  cmpFraction,
  concentrationRatio,
  DELEGATION_ENABLED,
  instant,
  isVigent,
  normalizedHerfindahl,
  ratio,
  walkChain,
  ZERO,
  type Delegation,
  type Instant,
  type MemberId,
} from '@koinonia/domain';
import {
  K_MAXIMO_INDIVIDUAL,
  K_NO_SE_PUBLICA,
  K_SE_ADVIERTE,
  NO_SE_PUBLICA,
  sellar,
} from '@koinonia/metrics';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  concentracionDelegacionDto,
  type BaldeDeReparto,
  type ConcentracionDelegacion,
  type InformeConcentracionDelegacion,
  type RepartoDeDelegacion,
} from '@koinonia/contracts';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El cálculo — puro, sin I/O, unidad de prueba propia (no necesita Fastify ni base de datos)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Lo que el cálculo necesita: el censo vigente y todas las delegaciones conocidas (de cualquier
 * ámbito y estado — la vigencia y el filtro por ámbito `global` se aplican adentro). */
export interface EntradaConcentracionDelegacion {
  readonly censo: readonly MemberId[];
  readonly delegaciones: readonly Delegation[];
  /** El «ahora» contra el que se evalúa vigencia. Lo asigna quien llama, nunca este módulo (ADR-0004). */
  readonly instante: Instant;
  /** Profundidad máxima de cadena. Por defecto la institucional (C.4.c, `DELEGATION_ENABLED.maxDepth` = 4). */
  readonly maxDepth?: number;
}

/** El delegado activo de ámbito `global`, por delegante, en `instante`. A lo sumo uno por C.1.b;
 * si los datos trajeran más de uno (log fabricado a mano), se resuelve con la misma prioridad que
 * usa el propio motor de escrutinio (`compareDelegationPriority`), nunca con el orden de llegada. */
function delegadoGlobalPorDelegante(
  delegaciones: readonly Delegation[],
  instante: Instant,
): ReadonlyMap<MemberId, MemberId> {
  const candidatasPorDelegante = new Map<MemberId, Delegation[]>();
  for (const d of delegaciones) {
    if (d.scope.kind !== 'global' || !isVigent(d, instante)) continue;
    const lista = candidatasPorDelegante.get(d.delegator);
    if (lista === undefined) candidatasPorDelegante.set(d.delegator, [d]);
    else lista.push(d);
  }
  const resultado = new Map<MemberId, MemberId>();
  for (const [delegante, candidatas] of candidatasPorDelegante) {
    // `candidatas` nunca está vacío: sólo se crea con un primer elemento (línea de arriba).
    const [elegida] = [...candidatas].sort(compareDelegationPriority);
    if (elegida !== undefined) resultado.set(delegante, elegida.delegate);
  }
  return resultado;
}

/**
 * Diez grupos de tamaño fijo (≈censo/10, nunca menos), del que más peso sostiene al que menos.
 *
 * `pesos` ya viene ordenado descendente y con longitud exactamente `censo.length` (rellenado con
 * ceros para quien delegó su voto: su peso lo sostiene otra persona en la cadena, no ella). El
 * tamaño del grupo es fijo por diseño —nunca depende de cuánta gente concentra peso realmente—: así
 * el primer grupo sigue teniendo ≈30 personas (con censo ~300) aunque sólo tres de ellas sostengan
 * peso de verdad, y la cifra publicada es la suma del grupo entero, no la de esas tres.
 */
function deciles(pesos: readonly number[]): readonly BaldeDeReparto[] {
  const n = pesos.length;
  const total = pesos.reduce((s, w) => s + w, 0);
  const grupos: BaldeDeReparto[] = [];
  let desde = 0;
  for (let i = 0; i < 10; i += 1) {
    const hasta = Math.floor(((i + 1) * n) / 10);
    const grupo = pesos.slice(desde, hasta);
    const sumaDelGrupo = grupo.reduce((s, w) => s + w, 0);
    grupos.push({
      personas: grupo.length,
      participacionDelPeso: total === 0 ? ZERO : ratio(sumaDelGrupo, total),
    });
    desde = hasta;
  }
  return grupos;
}

/**
 * La foto del colectivo. Pura: dos llamadas con la misma `entrada` producen el mismo informe.
 *
 * Sella la salida contra la identidad de cada persona del censo y cada delegante/delegado leído: si
 * un identificador sobreviviera al cálculo, `sellar()` lanza `FugaDeIdentidadError` aquí mismo, en
 * el cálculo, y nunca llega a formar parte de una respuesta HTTP.
 */
export function calcularConcentracionDeDelegacion(
  entrada: EntradaConcentracionDelegacion,
): InformeConcentracionDelegacion {
  const maxDepth = entrada.maxDepth ?? DELEGATION_ENABLED.maxDepth;
  const censoSet = new Set(entrada.censo);
  const delegadoDe = delegadoGlobalPorDelegante(entrada.delegaciones, entrada.instante);

  // El destino de una delegación tiene que seguir siendo alguien del censo vigente: si la persona
  // delegada ya no está, la cadena se corta ahí (silencio, no reasignación — misma filosofía que
  // `walkChain` aplica al ciclo y a la profundidad excedida).
  const edgeOf = (miembro: MemberId): MemberId | undefined => {
    const siguiente = delegadoDe.get(miembro);
    if (siguiente === undefined) return undefined;
    return censoSet.has(siguiente) ? siguiente : undefined;
  };
  const votaDirecto = (miembro: MemberId): boolean => !delegadoDe.has(miembro);

  const pesoPorReceptor = new Map<MemberId, number>();
  let sinAsignar = 0;
  for (const miembro of entrada.censo) {
    const resultado = walkChain(miembro, edgeOf, votaDirecto, maxDepth);
    if (resultado.kind === 'assigned') {
      pesoPorReceptor.set(resultado.terminal, (pesoPorReceptor.get(resultado.terminal) ?? 0) + 1);
    } else {
      sinAsignar += 1;
    }
  }

  // Censo completo, no sólo receptores: quien delegó cuenta con peso 0 EN SU PROPIO NOMBRE, porque
  // su voz ya la sostiene otra persona en la cadena. Es la diferencia entre medir concentración
  // «entre quienes tienen algo» y medir concentración «en todo el colectivo» — ver la cabecera.
  const pesosCompletos = entrada.censo
    .map((m) => pesoPorReceptor.get(m) ?? 0)
    .sort((a, b) => b - a);

  const receptoresConPeso = pesoPorReceptor.size;

  const repartoPublicado: RepartoDeDelegacion | undefined =
    receptoresConPeso < K_NO_SE_PUBLICA
      ? undefined
      : (() => {
          const normalizado = normalizedHerfindahl(pesosCompletos);
          const cr1 = concentrationRatio(pesosCompletos, entrada.censo.length);
          const alarma =
            cmpFraction(normalizado, HIGH_CONCENTRATION_HHI) >= 0 ||
            cmpFraction(cr1, HIGH_CONCENTRATION_CR1) >= 0;
          const mayorReceptor =
            receptoresConPeso < K_MAXIMO_INDIVIDUAL
              ? NO_SE_PUBLICA
              : ({
                  publicado: true,
                  personas: receptoresConPeso,
                  grupoPequeno: receptoresConPeso < K_SE_ADVIERTE,
                  valor: cr1,
                } as const);
          return {
            receptoresConPeso,
            personasSinAsignar: sinAsignar,
            reparto: normalizado,
            desigualdad: gini(pesosCompletos),
            mayorReceptor,
            deciles: deciles(pesosCompletos),
            alarma,
          };
        })();

  const informe: InformeConcentracionDelegacion = {
    medidoEn: entrada.instante,
    censo: entrada.censo.length,
    personasQueDelegan: delegadoDe.size,
    reparto:
      repartoPublicado === undefined
        ? NO_SE_PUBLICA
        : {
            publicado: true,
            personas: receptoresConPeso,
            grupoPequeno: receptoresConPeso < K_SE_ADVIERTE,
            valor: repartoPublicado,
          },
  };

  const identidades: string[] = [
    ...entrada.censo,
    ...entrada.delegaciones.flatMap((d) => [d.delegator, d.delegate]),
  ];
  return sellar(informe, identidades);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La ruta HTTP
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Exactamente lo que esta ruta necesita del ámbito de `buildApp`: nada más. */
export interface ContextoConcentracion {
  readonly clock: { readonly now: () => number };
  /** El censo activo, tal como esté definido hoy (no un padrón congelado de ninguna decisión). */
  readonly leerCenso: () => Promise<readonly MemberId[]>;
  /** Toda delegación conocida, de cualquier ámbito y estado: el filtro por ámbito y vigencia se
   * aplica dentro de `calcularConcentracionDeDelegacion`, no aquí. */
  readonly leerDelegaciones: () => Promise<readonly Delegation[]>;
}

/**
 * Registra la ruta de este fichero sobre `app`. No añade `onRequest` ni `setErrorHandler` propios:
 * hereda el de `buildApp`, así que sólo tiene sentido llamarla después de que `buildApp` los instale.
 *
 * No exige sesión: la salida es estadística agregada del colectivo entero, nunca de una persona
 * (misma condición que ya justifica `/metricas/salud` sin sesión), y `sellar()` lo garantiza en
 * tiempo de ejecución, no sólo por convención de quien escribió esta ruta.
 */
export function registrarRutasDeConcentracion(
  app: FastifyInstance,
  ctx: ContextoConcentracion,
): void {
  // GET /concentracion/delegaciones
  //   Exige: nada.
  //   Devuelve: ConcentracionDelegacion — la forma del reparto de poder por delegación del
  //   colectivo, sin nombrar a nadie, retenida por completo si muy pocas personas concentran peso.
  //   Ejemplo: fetch('/concentracion/delegaciones').then(r => r.json())
  //     → { medidoEn, censo, personasQueDelegan, reparto: { publicado: false } }
  //     → { medidoEn, censo, personasQueDelegan,
  //         reparto: { publicado: true, personas, grupoPequeno, valor: { reparto, desigualdad, ... } } }
  app.get('/concentracion/delegaciones', async (request): Promise<ConcentracionDelegacion> => {
    z.object({}).strict().parse(request.query);

    const [censo, delegaciones] = await Promise.all([ctx.leerCenso(), ctx.leerDelegaciones()]);
    const instante = instant(ctx.clock.now());

    const informe = calcularConcentracionDeDelegacion({ censo, delegaciones, instante });
    return concentracionDelegacionDto(informe);
  });
}
