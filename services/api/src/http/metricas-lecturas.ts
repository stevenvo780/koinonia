/**
 * Las cinco proyecciones reales que `ContextoMetricas` (`rutas-metricas.ts`) declara como interfaz
 * y no implementa — ese fichero es propiedad de otro agente y dice explícitamente que construirlas
 * es trabajo de quien integra. Este módulo es ese trabajo.
 *
 * ═══ Qué es un «acuerdo» aquí, y qué no se pudo derivar con precisión ═══
 *
 * El dominio no tiene un agregado llamado «acuerdo»: lo que más se le parece es una TAREA dentro de
 * una iniciativa activada — es lo único con círculo responsable, fecha comprometida (`dueAt`),
 * cierre (`completedAt`) y reloj detenible (`currentPause`, ADR-0040). Se usa esa lectura.
 *
 * Dos campos que pide `@koinonia/metrics` no tienen hoy una fuente real en el dominio, y en vez de
 * inventar una que parezca informativa sin serlo, se documenta la carencia y se usa un valor
 * constante (una sola categoría, o «sin-clasificar»), que es honesto: no fabrica variedad donde no
 * la hay.
 *
 *   1. `AcuerdoProyectado.tipo` — `InitiativeTask` no tiene un campo de categoría («redacción»,
 *      «convocatoria»…). Se usa la constante `TIPO_DE_ACUERDO_UNICO`. El desglose «por tipo» sale
 *      con una sola fila hasta que el dominio distinga tipos de tarea.
 *   2. `Estratos.nivel` y `Estratos.participacionPrevia` — `identity.member` (`identity.ts`,
 *      `MemberRecord`) sólo guarda `semestre` y `jornada`; C11 pide cuatro ejes y el paquete de
 *      métricas los exige los cuatro (`validarEstratos`). Se usa `SIN_CLASIFICAR` en ambos: el
 *      cruce por esos dos ejes sale con una única celda (cobertura global re-etiquetada), sin
 *      fabricar una distinción que la base de datos no sostiene. Añadir esos dos ejes es un cambio
 *      de esquema (`identity.member` + el flujo de alta), no algo que esta capa de lectura deba
 *      resolver por su cuenta.
 *
 * ═══ Qué SÍ tiene una fuente directa y sin aproximar ═══
 *
 *   - **Voz**: cada aporte a una deliberación (`ContributionRecord.authorId`/`submittedAt`) es un
 *     acto de habla real, con su autor y su instante.
 *   - **Cobertura** (los dos ejes que existen): `semestre`/`jornada` vienen literales de
 *     `identity.member`. Los «actos significativos» son los mismos aportes de deliberación más las
 *     papeletas emitidas — dos formas reales de participar, no una sesión ni un click.
 *   - **Rotación**: el núcleo activo se calcula sobre esos mismos aportes, en las dos ventanas.
 *   - **Deliberación/votación**: una deliberación cuenta sus intervenciones (`contributions.length`)
 *     en el instante de su cierre; una votación cuenta si fue unánime y si la precedió una
 *     deliberación sobre el mismo problema. La cadena decisión → propuesta → problema → deliberación
 *     se recorre completa: no es una aproximación, es indirecta porque así está modelado el dominio
 *     (una deliberación se abre sobre un problema, una decisión vota una propuesta).
 *
 * `unanime` sólo tiene una lectura directa para papeletas binarias y de consentimiento (sí/no,
 * a favor/objeción). Los métodos de puntuación, orden o mención (`score`/`ranking`/`grades`) no
 * tienen una noción de «unanimidad» de una sola cifra sin decidir un criterio adicional que el
 * dominio no fija; se cuentan, a propósito, como no unánimes — conservador, nunca al revés.
 */

import {
  identidadMiembro,
  type EntradaAcuerdos,
  type EntradaCobertura,
  type EntradaDeliberacion,
  type EntradaRotacion,
  type EntradaVoz,
  type Estratos,
  type IdentidadMiembro,
  type Instante,
  type Ventana,
} from '@koinonia/metrics';
import { ESCALATION_PRESCRIPTION_MS, type Ballot } from '@koinonia/domain';

import { CIRCULOS_LISTA } from './circles.js';
import { allMembers } from './identity.js';
import {
  listarDecisiones,
  listarDeliberaciones,
  listarIniciativas,
  listarPropuestas,
  type ServicioDeps,
} from './service.js';

/** Ver cabecera: no hay campo de categoría de tarea en el dominio. Una sola categoría, con nombre. */
const TIPO_DE_ACUERDO_UNICO = 'tarea';

/** Ver cabecera: los dos ejes de C11 que `identity.member` todavía no guarda. */
const SIN_CLASIFICAR = 'sin-clasificar';

/** Construye los cinco `leerEntradaX` de `ContextoMetricas` contra la base real. */
export function crearLectorasDeMetricas(deps: ServicioDeps): {
  readonly leerEntradaAcuerdos: (ventana: Ventana, instante: Instante) => Promise<EntradaAcuerdos>;
  readonly leerEntradaVoz: (ventana: Ventana) => Promise<EntradaVoz>;
  readonly leerEntradaCobertura: (ventana: Ventana) => Promise<EntradaCobertura>;
  readonly leerEntradaRotacion: (
    periodoAnterior: Ventana,
    periodoActual: Ventana,
  ) => Promise<EntradaRotacion>;
  readonly leerEntradaDeliberacion: (ventana: Ventana) => Promise<EntradaDeliberacion>;
} {
  /** Cada aporte a cada deliberación que existe hoy. El paquete filtra por ventana él mismo. */
  async function todosLosAportes(): Promise<
    { readonly autor: IdentidadMiembro; readonly instante: number }[]
  > {
    const deliberaciones = await listarDeliberaciones(deps);
    const aportes: { autor: IdentidadMiembro; instante: number }[] = [];
    for (const { state } of deliberaciones) {
      for (const c of state.contributions) {
        aportes.push({ autor: identidadMiembro(c.authorId), instante: c.submittedAt });
      }
    }
    return aportes;
  }

  return {
    async leerEntradaAcuerdos(ventana, instante) {
      const iniciativas = await listarIniciativas(deps);
      const acuerdos: EntradaAcuerdos['acuerdos'][number][] = [];
      for (const { state } of iniciativas) {
        for (const tarea of state.tasks) {
          acuerdos.push({
            circulo: state.circleId,
            tipo: TIPO_DE_ACUERDO_UNICO,
            acordadoEn: tarea.createdAt,
            vencimiento: tarea.dueAt,
            cerradoEn: tarea.completedAt ?? null,
            relojDetenido: tarea.currentPause !== undefined,
          });
        }
      }

      const client = await deps.pool.connect();
      let miembros;
      try {
        miembros = await allMembers(client, instante);
      } finally {
        client.release();
      }
      const circulos = CIRCULOS_LISTA.map((c) => ({
        circulo: c.id,
        // `.includes` es invariante con el tipo marcado `CircleId`; `.some` con `===` compara
        // igual que ya hace `existeCirculo` en `circles.ts`, sin forzar el tipo con un cast.
        personas: miembros.filter((m) => m.circles.some((circulo) => circulo === c.id)).length,
      }));

      return { ventana, instante, acuerdos, circulos, prescripcionMs: ESCALATION_PRESCRIPTION_MS };
    },

    async leerEntradaVoz(ventana) {
      const aportes = await todosLosAportes();
      const client = await deps.pool.connect();
      let censo: number;
      try {
        censo = (await allMembers(client, ventana.hasta)).length;
      } finally {
        client.release();
      }
      return { ventana, aportes, censo };
    },

    async leerEntradaCobertura(ventana) {
      const client = await deps.pool.connect();
      let miembros;
      try {
        miembros = await allMembers(client, ventana.hasta);
      } finally {
        client.release();
      }
      const padron = miembros.map((m) => ({
        miembro: identidadMiembro(m.memberId),
        estratos: {
          semestre: m.semestre,
          jornada: m.jornada,
          nivel: SIN_CLASIFICAR,
          participacionPrevia: SIN_CLASIFICAR,
        } satisfies Estratos,
      }));

      const decisiones = await listarDecisiones(deps);
      const papeletas = decisiones.flatMap(({ state }) =>
        state.ballots.map((b) => ({ miembro: identidadMiembro(b.voter), instante: b.castAt })),
      );
      const aportes = await todosLosAportes();
      const actos = [
        ...aportes.map((a) => ({ miembro: a.autor, instante: a.instante })),
        ...papeletas,
      ];

      return { ventana, padron, actos };
    },

    async leerEntradaRotacion(periodoAnterior, periodoActual) {
      const aportes = await todosLosAportes();
      return {
        periodoAnterior,
        periodoActual,
        aportesAnteriores: aportes,
        aportesActuales: aportes,
      };
    },

    async leerEntradaDeliberacion(ventana) {
      const deliberaciones = await listarDeliberaciones(deps);
      const informeDeliberaciones = deliberaciones
        .filter((d) => d.state.closesAt !== undefined)
        .map((d) => ({
          instante: d.state.closesAt as number,
          intervenciones: d.state.contributions.length,
        }));

      // Problema deliberado → propuesta(s) de ese problema → decisiones sobre esas propuestas: la
      // cadena real que conecta una votación con la deliberación que (si la hubo) la precedió.
      // Una deliberación se abre sobre un problema (`state.problemId`); una decisión vota una
      // versión de una propuesta (`config.proposalId`), y la propuesta señala su problema
      // (`state.problemId`). No hay un enlace directo decisión↔deliberación en el dominio: éste es
      // el camino que sí existe.
      const problemasConDeliberacionPrevia = new Set(
        deliberaciones
          .filter((d) => d.state.problemId !== undefined && d.state.closesAt !== undefined)
          .map((d) => d.state.problemId as string),
      );
      const propuestas = await listarPropuestas(deps);
      const problemaDeLaPropuesta = new Map(
        propuestas.map((p) => [p.id, p.state.problemId] as const),
      );

      const decisiones = await listarDecisiones(deps);
      const informeVotaciones: EntradaDeliberacion['votaciones'][number][] = [];
      for (const { state } of decisiones) {
        const instante = state.resultComputedAt ?? state.closedAt;
        if (instante === undefined) continue;
        const proposalId = state.config?.proposalId;
        const problemId =
          proposalId === undefined ? undefined : problemaDeLaPropuesta.get(proposalId);
        const conDeliberacionPrevia =
          problemId !== undefined && problemasConDeliberacionPrevia.has(problemId);
        informeVotaciones.push({
          instante,
          unanime: esUnanime(state.ballots),
          conDeliberacionPrevia,
        });
      }

      return { ventana, deliberaciones: informeDeliberaciones, votaciones: informeVotaciones };
    },
  };
}

/**
 * ¿Ninguna papeleta expresa disenso? Sólo tiene lectura directa para `binary` (todas `approve`) y
 * `consent` (ninguna en `object`). `score`/`ranking`/`grades` no tienen una unanimidad de una cifra
 * sin más criterio del que el dominio da, así que cuentan como no unánimes — ver cabecera.
 */
function esUnanime(ballots: readonly Ballot[]): boolean {
  const conOpinion = ballots.filter((b) => b.payload.kind !== 'abstain');
  if (conOpinion.length === 0) return false;
  return conOpinion.every((b) => {
    const payload = b.payload;
    if (payload.kind === 'binary') return payload.approve;
    if (payload.kind === 'consent') return payload.stance !== 'object';
    return false;
  });
}
