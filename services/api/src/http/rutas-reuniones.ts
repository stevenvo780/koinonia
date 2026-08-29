/**
 * La pantalla «Reuniones» que el pliego pide y no existía (PRODUCT §4).
 *
 * ═══ Qué resuelve ═══
 *
 * De las 14 pantallas que enumera PRODUCT.md §4, faltaba ésta. El principio del proyecto —«la
 * reunión presencial es una herramienta más, no el sistema de gobierno»— es la razón por la que esto
 * NO es un calendario: convoca con orden del día, enlaza los problemas y deliberaciones que va a
 * tratar, y deja constancia de lo que pasó de modo que quien no asistió no pierda participación
 * (principio 1 de GOVERNANCE.md). `packages/domain/src/workspace/meeting.ts` tiene el agregado
 * completo, con su propia cabecera explicando cada decisión de diseño; este fichero es la frontera
 * HTTP sobre él.
 *
 * ═══ Por qué «convertir en propuesta» no crea la propuesta acá ═══
 *
 * «No se propone sin problema» ya vive en `workspace/proposal.ts`, y la única puerta para crear una
 * propuesta es `POST /propuestas` (comentario de `TRAMOS` en `apps/web/components/marco.tsx`:
 * «una propuesta no se empieza desde su índice»). Reinventar esa puerta acá —una segunda ruta que
 * también sabe crear una propuesta— sería exactamente la clase de «gobernanza nueva» que este
 * encargo pide no inventar, y dos caminos hacia el mismo acto son dos caminos que hay que mantener
 * de acuerdo. Por eso `POST /reuniones/:id/acuerdos/:acuerdoId/propuesta` no crea nada: la pantalla
 * primero manda a la persona a `/propuestas/nueva` (prellenada con el problema del acuerdo), y
 * cuando esa propuesta ya existe, esta ruta sólo dice «este acuerdo se convirtió en aquélla» — el
 * mismo tipo de enlace que `proposal.ts:linkDecision` deja después de que una decisión ya se abrió.
 *
 * Con una comprobación de más, porque el cliente que llama esta ruta pudo mentir: se vuelve a leer
 * la propuesta del ledger y se exige que responda al MISMO problema que el acuerdo declaró. Sin
 * esto, cualquier `propuestaId` válido —de cualquier reunión, de cualquier problema— pasaría como
 * si fuera el fruto de este acuerdo.
 *
 * ═══ Cómo se integra ═══
 *
 * Mismo patrón aditivo que `rutas-iniciativas.ts`/`rutas-objeciones.ts`: exporta
 * `registrarRutasDeReuniones(app, ctx)`, para que `buildApp` (`app.ts`) la registre junto a las
 * demás. No toca `app.ts` más que esa línea de registro.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  type AcuerdoDeReunion,
  convocarReunion as convocarReunionSchema,
  enlazarAcuerdoConPropuesta as enlazarAcuerdoConPropuestaSchema,
  publicarActa as publicarActaSchema,
  type PuntoOrdenDelDia,
  type ReunionDetalle,
  type ReunionResumen,
} from '@koinonia/contracts';
import {
  type Actor,
  circleId,
  convertibleAgreements,
  convokeMeeting,
  eventId,
  hasRecordedAttendance,
  instant,
  linkProposalToAgreement,
  type MeetingState,
  memberId,
  publishMinutes,
  replayMeeting,
} from '@koinonia/domain';

import type { PgClient, PgPool } from '../db/client.js';
import {
  listAggregateIds,
  loadMeetingLog,
  MEETING_AGGREGATE_TYPE,
  persistMeetingLog,
} from '../workspace/repository.js';

import { existeCirculo } from './circles.js';
import {
  type ServicioDeps,
  ServicioError,
  verDeliberacion,
  verProblema,
  verPropuesta,
} from './service.js';

/** Parsea con Zod y deja que `errorDe` en `app.ts` traduzca el `ZodError` (mismo patrón que el
 * resto de las rutas de este directorio: cada fichero define su propio `parse` local). */
function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

/** Contexto mínimo que estas rutas necesitan, separado del contexto general del servidor. */
export interface ContextoReuniones {
  readonly deps: ServicioDeps;
  /** Mismo cierre que `actorDe` en `app.ts`: no se importa de allí porque no lo exporta. */
  readonly actorDe: (request: FastifyRequest) => Actor;
  /** Mismo cierre que `cupoDeEscritura` en `app.ts`: comprueba el cupo de escritura del actor. */
  readonly cupoDeEscritura: (request: FastifyRequest) => Promise<void>;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Composición con la persistencia. Mismas utilidades pequeñas que `service.ts` mantiene privadas
// (`conCliente`, `ahora`, `nuevoEventId`): se repiten acá porque no se exportan desde allá y son
// tres líneas cada una — copiarlas es más simple y más seguro que abrir una costura nueva en un
// fichero de 4700 líneas para tres funciones triviales.
// ═════════════════════════════════════════════════════════════════════════════════════════════

async function conCliente<T>(pool: PgPool, fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

function nuevoEventId(deps: ServicioDeps) {
  return eventId(deps.ports.random.opaqueId());
}

function ahora(deps: ServicioDeps) {
  return instant(deps.ports.clock.now());
}

export interface ReunionConId {
  readonly id: string;
  readonly state: MeetingState;
}

export async function listarReuniones(deps: ServicioDeps): Promise<readonly ReunionConId[]> {
  return conCliente(deps.pool, async (client) => {
    const ids = await listAggregateIds(client, MEETING_AGGREGATE_TYPE);
    const salida: ReunionConId[] = [];
    for (const id of ids) {
      const log = await loadMeetingLog(client, id);
      if (log.length > 0) salida.push({ id, state: replayMeeting(log) });
    }
    return salida;
  });
}

export async function verReunion(deps: ServicioDeps, id: string): Promise<ReunionConId> {
  return conCliente(deps.pool, async (client) => {
    const log = await loadMeetingLog(client, id);
    if (log.length === 0) throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa reunión');
    return { id, state: replayMeeting(log) };
  });
}

export interface PuntoEntrada {
  readonly texto: string;
  readonly problemaId?: string | undefined;
  readonly deliberacionId?: string | undefined;
}

export async function crearReunion(
  deps: ServicioDeps,
  actor: Actor,
  input: {
    readonly requestId: string;
    readonly titulo: string;
    readonly circuloId: string;
    readonly cuando: number;
    readonly lugar?: string | undefined;
    readonly enlaceRemoto?: string | undefined;
    readonly ordenDelDia: readonly PuntoEntrada[];
  },
): Promise<ReunionConId> {
  // «No se convoca enlazando lo que no existe»: mismo criterio que `crearPropuesta` con su problema
  // de origen — se comprueba que cada referencia EXISTE en el ledger, no que el cliente mandó un
  // identificador con la forma correcta.
  for (const punto of input.ordenDelDia) {
    if (punto.problemaId !== undefined) await verProblema(deps, punto.problemaId);
    if (punto.deliberacionId !== undefined) await verDeliberacion(deps, punto.deliberacionId);
  }

  const meetingId = deps.ports.random.opaqueId();
  const log = await convokeMeeting(
    { eventId: nuevoEventId(deps), at: ahora(deps), actor },
    {
      meetingId,
      title: input.titulo,
      circleId: circleId(input.circuloId),
      scheduledAt: instant(input.cuando),
      location: input.lugar,
      remoteLink: input.enlaceRemoto,
      agenda: input.ordenDelDia.map((punto) => ({
        itemId: deps.ports.random.opaqueId(),
        text: punto.texto,
        problemId: punto.problemaId,
        deliberationId: punto.deliberacionId,
      })),
    },
  );
  await persistMeetingLog(deps.pool, log, { requestId: input.requestId });
  return { id: meetingId, state: replayMeeting(log) };
}

export interface AcuerdoEntrada {
  readonly texto: string;
  readonly problemaId?: string | undefined;
}

export async function publicarActaDe(
  deps: ServicioDeps,
  actor: Actor,
  reunionId: string,
  input: {
    readonly requestId: string;
    readonly resumen: string;
    readonly asistentes: readonly string[];
    readonly acuerdos: readonly AcuerdoEntrada[];
  },
): Promise<MeetingState> {
  for (const acuerdo of input.acuerdos) {
    if (acuerdo.problemaId !== undefined) await verProblema(deps, acuerdo.problemaId);
  }
  const log = await conCliente(deps.pool, (c) => loadMeetingLog(c, reunionId));
  if (log.length === 0) throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa reunión');
  const siguiente = await publishMinutes(
    log,
    { eventId: nuevoEventId(deps), at: ahora(deps), actor },
    {
      summary: input.resumen,
      attendees: input.asistentes.map((m) => memberId(m)),
      agreements: input.acuerdos.map((a) => ({
        agreementId: deps.ports.random.opaqueId(),
        text: a.texto,
        problemId: a.problemaId,
      })),
    },
  );
  await persistMeetingLog(deps.pool, siguiente, { requestId: input.requestId });
  return replayMeeting(siguiente);
}

/**
 * Enlaza un acuerdo YA publicado con la propuesta que salió de él. Ver la cabecera del fichero: no
 * crea la propuesta, sólo deja la constancia — y comprueba que la propuesta de verdad responde al
 * problema que el acuerdo declaró antes de aceptar el enlace.
 */
export async function convertirAcuerdoEnPropuesta(
  deps: ServicioDeps,
  actor: Actor,
  reunionId: string,
  acuerdoId: string,
  input: { readonly requestId: string; readonly propuestaId: string },
): Promise<MeetingState> {
  const log = await conCliente(deps.pool, (c) => loadMeetingLog(c, reunionId));
  if (log.length === 0) throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa reunión');
  const estado = replayMeeting(log);
  const acuerdo = estado.agreements.find((a) => a.agreementId === acuerdoId);
  if (acuerdo === undefined) {
    throw new ServicioError('NO_ENCONTRADO', 404, 'esta reunión no tiene ese acuerdo');
  }

  /*
   * Los dos casos son distintos y hay que decirlos distinto — lo encontró la revisión independiente
   * ejecutándolo, no leyéndolo.
   *
   * Sin esta primera rama, un acuerdo que NO declara problema caía en la comparación de abajo (su
   * `problemId` es `undefined` y el de la propuesta no), y la persona recibía «esa propuesta
   * responde a otro problema». Es mentira, y de la peor clase: manda a revisar la propuesta cuando
   * lo que falta está en el acuerdo. Quien lo lea va a cambiar de propuesta una y otra vez sin que
   * ninguna funcione nunca.
   */
  if (acuerdo.problemId === undefined) {
    throw new ServicioError(
      'AGREEMENT_WITHOUT_PROBLEM',
      422,
      'este acuerdo no dice a qué problema responde, así que todavía no se puede volver propuesta',
    );
  }

  const propuesta = await verPropuesta(deps, input.propuestaId);
  if (propuesta.state.problemId !== acuerdo.problemId) {
    throw new ServicioError(
      'PROPOSAL_PROBLEM_MISMATCH',
      409,
      'esa propuesta responde a otro problema: no es la que salió de este acuerdo',
    );
  }

  const siguiente = await linkProposalToAgreement(
    log,
    { eventId: nuevoEventId(deps), at: ahora(deps), actor },
    { agreementId: acuerdoId, proposalId: input.propuestaId },
  );
  await persistMeetingLog(deps.pool, siguiente, { requestId: input.requestId });
  return replayMeeting(siguiente);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Presentación
// ═════════════════════════════════════════════════════════════════════════════════════════════

function reunionResumenDto(
  id: string,
  state: MeetingState,
  quien: string | undefined,
): ReunionResumen {
  return {
    id,
    titulo: state.title,
    circuloId: state.circleId ?? '',
    cuando: state.scheduledAt ?? 0,
    ...(state.location === undefined ? {} : { lugar: state.location }),
    ...(state.remoteLink === undefined ? {} : { enlaceRemoto: state.remoteLink }),
    puntosOrdenDelDia: state.agenda.length,
    actaPublicada: state.minutesPublished,
    laConvoqueYo: quien !== undefined && state.convenedBy === quien,
  };
}

/**
 * Título de un problema, o `undefined` si ya no está. Cachea por reunión: un orden del día repite
 * el mismo problema en varios puntos con frecuencia, y este título es público (`problem:read` es
 * `OPEN`), así que resolverlo acá no filtra nada que la propia pantalla del problema no muestre.
 */
async function tituloDelProblema(
  deps: ServicioDeps,
  cache: Map<string, string>,
  problemaId: string,
): Promise<string | undefined> {
  const cacheado = cache.get(problemaId);
  if (cacheado !== undefined) return cacheado;
  try {
    const { state } = await verProblema(deps, problemaId);
    cache.set(problemaId, state.title);
    return state.title;
  } catch {
    // El problema pudo borrarse del alcance de esta consulta o el identificador ya no resuelve:
    // se omite el título, nunca se rompe la pantalla por un enlace histórico.
    return undefined;
  }
}

async function puntoDto(
  deps: ServicioDeps,
  cache: Map<string, string>,
  item: MeetingState['agenda'][number],
): Promise<PuntoOrdenDelDia> {
  const problemaTitulo =
    item.problemId === undefined ? undefined : await tituloDelProblema(deps, cache, item.problemId);
  // El título de la deliberación es, en esta plataforma, el título del problema que trata (no
  // tiene uno propio): se resuelve encadenando su `problemId` con el mismo camino que un problema
  // suelto, así el cache se comparte entre puntos que enlazan el problema y puntos que enlazan la
  // deliberación sobre ese mismo problema.
  const deliberacionTitulo =
    item.deliberationId === undefined
      ? undefined
      : await (async (deliberacionId: string) => {
          try {
            const { state: deliberacion } = await verDeliberacion(deps, deliberacionId);
            if (deliberacion.problemId === undefined) return undefined;
            return await tituloDelProblema(deps, cache, deliberacion.problemId);
          } catch {
            return undefined;
          }
        })(item.deliberationId);
  return {
    id: item.itemId,
    texto: item.text,
    ...(item.problemId === undefined ? {} : { problemaId: item.problemId }),
    ...(problemaTitulo === undefined ? {} : { problemaTitulo }),
    ...(item.deliberationId === undefined ? {} : { deliberacionId: item.deliberationId }),
    ...(deliberacionTitulo === undefined ? {} : { deliberacionTitulo }),
  };
}

async function reunionDetalleDto(
  deps: ServicioDeps,
  id: string,
  state: MeetingState,
  quien: string | undefined,
): Promise<ReunionDetalle> {
  const convertibles = new Set(convertibleAgreements(state).map((a) => a.agreementId));
  const cacheDeTitulos = new Map<string, string>();
  const ordenDelDia: PuntoOrdenDelDia[] = [];
  for (const item of state.agenda) ordenDelDia.push(await puntoDto(deps, cacheDeTitulos, item));
  const acuerdos: AcuerdoDeReunion[] = [];
  for (const a of state.agreements) {
    const problemaTitulo =
      a.problemId === undefined
        ? undefined
        : await tituloDelProblema(deps, cacheDeTitulos, a.problemId);
    acuerdos.push({
      id: a.agreementId,
      texto: a.text,
      ...(a.problemId === undefined ? {} : { problemaId: a.problemId }),
      ...(problemaTitulo === undefined ? {} : { problemaTitulo }),
      ...(a.proposalId === undefined ? {} : { propuestaId: a.proposalId }),
      puedeConvertirseEnPropuesta: convertibles.has(a.agreementId),
    });
  }
  return {
    ...reunionResumenDto(id, state, quien),
    ordenDelDia,
    ...(state.summary === undefined ? {} : { resumenActa: state.summary }),
    asistentes: [...state.attendees],
    actaSinAsistentes: state.minutesPublished && !hasRecordedAttendance(state),
    acuerdos,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Rutas
// ═════════════════════════════════════════════════════════════════════════════════════════════

const idParamsSchema = z.object({ id: z.string() }).strict();
const agreementParamsSchema = z.object({ id: z.string(), acuerdoId: z.string() }).strict();

export function registrarRutasDeReuniones(app: FastifyInstance, ctx: ContextoReuniones): void {
  const { deps } = ctx;

  // GET /reuniones — pública, igual que /problemas y /propuestas: PRODUCT §4 no la condiciona a
  // entrar. `laConvoqueYo` sale `false` para quien mira sin cuenta.
  app.get('/reuniones', async (request) => {
    z.object({}).strict().parse(request.query);
    const quien = ctx.actorDe(request).memberId;
    return (await listarReuniones(deps)).map(({ id, state }) =>
      reunionResumenDto(id, state, quien),
    );
  });

  app.post('/reuniones', async (request, reply) => {
    await ctx.cupoDeEscritura(request);
    const cuerpo = parse(convocarReunionSchema, request.body);
    if (!existeCirculo(cuerpo.circuloId)) {
      throw new ServicioError('NO_ENCONTRADO', 404, 'ese grupo no existe');
    }
    const actor = ctx.actorDe(request);
    const creada = await crearReunion(deps, actor, {
      requestId: cuerpo.requestId,
      titulo: cuerpo.titulo,
      circuloId: cuerpo.circuloId,
      cuando: cuerpo.cuando,
      lugar: cuerpo.lugar,
      enlaceRemoto: cuerpo.enlaceRemoto,
      ordenDelDia: cuerpo.ordenDelDia.map((punto) => ({
        texto: punto.texto,
        problemaId: punto.problemaId,
        deliberacionId: punto.deliberacionId,
      })),
    });
    return await reply
      .status(201)
      .send(await reunionDetalleDto(deps, creada.id, creada.state, actor.memberId));
  });

  app.get('/reuniones/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const { state } = await verReunion(deps, id);
    return reunionDetalleDto(deps, id, state, ctx.actorDe(request).memberId);
  });

  app.post('/reuniones/:id/acta', async (request) => {
    await ctx.cupoDeEscritura(request);
    const { id } = parse(idParamsSchema, request.params);
    const cuerpo = parse(publicarActaSchema, request.body);
    const actor = ctx.actorDe(request);
    const state = await publicarActaDe(deps, actor, id, {
      requestId: cuerpo.requestId,
      resumen: cuerpo.resumen,
      asistentes: cuerpo.asistentes,
      acuerdos: cuerpo.acuerdos.map((a) => ({ texto: a.texto, problemaId: a.problemaId })),
    });
    return reunionDetalleDto(deps, id, state, actor.memberId);
  });

  app.post('/reuniones/:id/acuerdos/:acuerdoId/propuesta', async (request) => {
    await ctx.cupoDeEscritura(request);
    const { id, acuerdoId } = parse(agreementParamsSchema, request.params);
    const cuerpo = parse(enlazarAcuerdoConPropuestaSchema, request.body);
    const actor = ctx.actorDe(request);
    const state = await convertirAcuerdoEnPropuesta(deps, actor, id, acuerdoId, cuerpo);
    return reunionDetalleDto(deps, id, state, actor.memberId);
  });
}

export type { AcuerdoDeReunion };
