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
 * ═══ Qué ámbitos se recorren, y la mentira que esto reemplaza ═══
 *
 * La primera versión de este fichero recorría sólo delegaciones de ámbito `global`, razonando que
 * `circle` y `topic` «sólo tienen sentido resueltas contra una decisión concreta». Eso es cierto
 * para `topic` (ver el porqué en `service.ts`, junto a `topics: []`), pero era una lectura FALSA
 * para `circle`: el único punto de concesión real de esta aplicación (`delegarVoto`,
 * `services/api/src/http/service.ts`) sólo ha concedido nunca `{ kind: 'circle', ... }` — `global`
 * no lo produce ninguna acción de usuario, ni antes ni ahora (ver el porqué junto a esa línea) —
 * así que una ruta que sólo miraba `global` no contaba NINGUNA delegación real, jamás. El síntoma
 * no era un error: era «nadie prestó su voto», siempre, con datos o sin ellos. Un fallo que se
 * parece exactamente a que todo funcione, hasta que alguien presta el voto y la cifra no se mueve.
 *
 * Ahora se recorren `global` y `circle`. Se deja fuera `topic`, y por la razón correcta esta vez:
 * `matchesScope` para `topic` exige que el asunto tenga ese tema entre los suyos, y esta foto no
 * vive dentro de ningún asunto contra el cual resolver eso — ni falta que hace, porque hoy ninguna
 * decisión de este producto llega a abrirse con un tema puesto (`topics` se congela `[]` siempre;
 * ver `service.ts`).
 *
 * ═══ Por qué esto sigue siendo una foto aproximada, y de qué manera ═══
 *
 * TODA delegación de este producto —sea cual sea su ámbito nominal— vive y muere en el agregado de
 * la ÚNICA decisión donde se concedió: `escribirSobreDecision` la anexa al log de esa decisión, y
 * el escrutinio de cualquier OTRA decisión ni siquiera abre ese log. Esta ruta, en cambio, aplana
 * las delegaciones de TODAS las decisiones del historial (`leerDelegaciones`, `app.ts`) en un solo
 * grafo, como si cada préstamo fuera un hecho permanente del colectivo y no un préstamo de una
 * votación puntual. Esa es la aproximación real que hace esta foto — no «pertenecer a más de un
 * grupo», que fue lo que decía (falsamente) una versión anterior de este comentario. El reparto real
 * de poder en una decisión concreta puede diferir de lo que se ve acá. Documentado también en
 * `packages/contracts/src/concentracion.ts`.
 *
 * ═══ Cómo se integra ═══
 *
 * Exporta `registrarRutasDeConcentracion(app, ctx)`; `buildApp` (`app.ts`) la llama con `leerCenso`
 * (reutiliza `allMembers`) y `leerDelegaciones` (aplana `state.delegations` de cada decisión del
 * ledger, filtrada a las que siguen `Open` — ver el porqué junto a esa función).
 */

import {
  cmpFraction,
  compareIds,
  concentrationRatio,
  DELEGATION_ENABLED,
  gini,
  HIGH_CONCENTRATION_CR1,
  HIGH_CONCENTRATION_HHI,
  instant,
  isVigent,
  normalizedHerfindahl,
  ratio,
  scopeSpecificity,
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
 * ámbito y estado — la vigencia y el filtro por ámbito se aplican adentro; ver la cabecera del
 * módulo para qué ámbitos se cuentan y por qué). */
export interface EntradaConcentracionDelegacion {
  readonly censo: readonly MemberId[];
  readonly delegaciones: readonly Delegation[];
  /** El «ahora» contra el que se evalúa vigencia. Lo asigna quien llama, nunca este módulo (ADR-0004). */
  readonly instante: Instant;
  /** Profundidad máxima de cadena. Por defecto la institucional (C.4.c, `DELEGATION_ENABLED.maxDepth` = 4). */
  readonly maxDepth?: number;
}

/**
 * Compara dos delegaciones que pueden venir de DECISIONES DISTINTAS, para elegir cuál gobierna a un
 * mismo delegante en esta foto aplanada del colectivo.
 *
 * A propósito NO es `compareDelegationPriority` del dominio (mismo criterio de especificidad, pero
 * desempata por `grantedSeq`): ese número sólo es comparable DENTRO del agregado de una misma
 * decisión — es la posición en SU log (`grantedSeq: log.length + 1`, `packages/domain/src/
 * engine.ts`). Esta función recibe delegaciones ya aplanadas de decisiones distintas: dos préstamos
 * de agregados distintos pueden compartir `grantedSeq` sin que signifique nada (o sin que uno sea
 * «después» del otro de ninguna forma real), y ordenarlos por ese número sería un criterio
 * arbitrario disfrazado de determinismo. El escenario es real, no hipotético: una misma persona
 * puede prestar el voto en dos decisiones abiertas a la vez —de dos círculos distintos, cada
 * préstamo con su propio `circle:X`— y esta foto tiene que elegir una sola arista de salida para
 * ella. Se desempata por `grantedAt` —un instante de reloj real, comparable entre agregados
 * distintos— y, si hasta eso coincide, por `delegationId` para que el orden siga siendo total.
 */
function compararEntreDecisiones(a: Delegation, b: Delegation): number {
  const porEspecificidad = scopeSpecificity(b.scope) - scopeSpecificity(a.scope);
  if (porEspecificidad !== 0) return porEspecificidad;
  if (a.grantedAt !== b.grantedAt) return b.grantedAt - a.grantedAt;
  return compareIds(a.delegationId, b.delegationId);
}

/**
 * El delegado activo, por delegante, en `instante` — de ámbito `global` o `circle` (`topic` queda
 * fuera; ver la cabecera del módulo). Lo normal es a lo sumo uno por delegante (C.1.b lo impide
 * DENTRO de una misma decisión), pero al aplanar decisiones distintas una misma persona puede traer
 * más de uno a la vez (ver `compararEntreDecisiones`); cuando pasa, se resuelve con esa prioridad,
 * nunca con el orden de llegada al array.
 */
function delegadoActivoPorDelegante(
  delegaciones: readonly Delegation[],
  instante: Instant,
): ReadonlyMap<MemberId, MemberId> {
  const candidatasPorDelegante = new Map<MemberId, Delegation[]>();
  for (const d of delegaciones) {
    if (d.scope.kind === 'topic' || !isVigent(d, instante)) continue;
    const lista = candidatasPorDelegante.get(d.delegator);
    if (lista === undefined) candidatasPorDelegante.set(d.delegator, [d]);
    else lista.push(d);
  }
  const resultado = new Map<MemberId, MemberId>();
  for (const [delegante, candidatas] of candidatasPorDelegante) {
    // `candidatas` nunca está vacío: sólo se crea con un primer elemento (línea de arriba).
    const [elegida] = [...candidatas].sort(compararEntreDecisiones);
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
  const delegadoDe = delegadoActivoPorDelegante(entrada.delegaciones, entrada.instante);

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
  /**
   * Delegaciones a considerar, de cualquier ámbito y estado: el filtro por ámbito y vigencia se
   * aplica dentro de `calcularConcentracionDeDelegacion`, no aquí.
   *
   * Lo que este cálculo NO puede filtrar por su cuenta es de qué DECISIÓN viene cada una — un
   * `Delegation` no carga el estado de su decisión, sólo su propio `expiresAt`/`revokedAt` — así que
   * es responsabilidad de quien implemente esto (`app.ts`) entregar sólo las de decisiones todavía
   * `Open`. Sin ese filtro, una decisión cerrada ANTES de su `closesAt` programado (cierre anticipado
   * o manual) sigue aportando delegaciones aquí hasta ese `closesAt` original, aunque su votación ya
   * haya terminado — ver el porqué junto a `leerDelegaciones` en `app.ts`.
   */
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
