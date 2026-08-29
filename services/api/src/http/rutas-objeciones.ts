/**
 * Ruta para desestimar una objeción sociocrática (B.3.a, ADR-0031, ADR-0032).
 *
 * ═══ El hueco que cierra ═══
 *
 * `packages/domain/src/engine.ts` (caso `ObjectionDismissed`, líneas 480-514) ya valida de verdad
 * una desestimación: tamaño exacto del panel, exclusión de quien objeta, dos tercios del panel y
 * motivación no vacía. Lo que no existía era: (a) un algoritmo real de sorteo del panel —
 * `panelSelection: 'sortition'` en `packages/contracts` era sólo una etiqueta— y (b) una ruta HTTP
 * que emita el evento. Esta ruta cierra las dos cosas: sortea con
 * `sortObjectionPanel` (`@koinonia/domain`, ADR-0031) y publica `ObjectionDismissed`.
 *
 * ═══ Cómo se integra ═══
 *
 * Este fichero **no toca `app.ts`**. Exporta `registrarRutasDeObjeciones(app, ctx)`, para que un
 * integrador la registre junto a las demás — mismo patrón que
 * `services/api/src/http/rutas-cierre-ciclo.ts`:
 *
 *     registrarRutasDeObjeciones(app, { deps, actorDe, cupoDeEscritura });
 *
 * ═══ Por qué esta ruta también publica `ObjectionRaised` cuando hace falta ═══
 *
 * Levantar una objeción hoy sólo dura una papeleta (`BallotPayload.kind === 'consent'` con
 * `stance === 'object'`, ver `emitirPapeleta`/`payloadDePapeleta` en `service.ts`). Eso ya alcanza
 * para el escrutinio: `tally/consent.ts:mergeObjections` trata una objeción que sólo vive en una
 * papeleta como admitida, exactamente igual que si tuviera su propio evento («B.3.a: toda objeción
 * nace admitida»). Pero `ObjectionDismissed` no mira las papeletas: `engine.ts:findObjection` sólo
 * busca en `state.objections`, que se llena **exclusivamente** con `ObjectionRaised`. Ninguna ruta
 * emite ese evento hoy, así que sin este paso `ObjectionDismissed` sería tan inalcanzable como antes
 * — el mismo problema descrito en `docs/OBJETIVO.md`, movido un evento más adelante.
 *
 * La solución no es inventar un dato nuevo: es hacer explícito, con su propio evento, lo que la
 * papeleta ya declaró. Si la objeción todavía no tiene `ObjectionRaised` en el log, esta ruta lo
 * publica primero —con el `by` y el texto que ya traía la papeleta, sin tocar una palabra— y recién
 * después publica `ObjectionDismissed`.
 *
 * ═══ Y por qué toda la operación va dentro del cerrojo ═══
 *
 * Los dos eventos se escriben juntos, pero eso NO alcanzaba. Esta ruta leía el log con
 * `verDecision` —sin transacción y sin cerrojo—, y sólo al final persistía con `persistDecisionLog`
 * sobre el pool. Era el último escritor del repositorio con ese patrón; el resto pasa por
 * `escribirSobreDecision`, que toma el cerrojo ANTES de leer.
 *
 * La diferencia no es teórica. Entre esa lectura y esa escritura cabe una papeleta, y con UNA sola
 * interpuesta —el caso probable, no el raro— la aritmética de `persistDecisionLog` cuadraba por
 * casualidad: el tramo pendiente se quedaba sólo con el `ObjectionDismissed`, descartaba el
 * `ObjectionRaised` que lo precede, la comprobación de densidad daba el número esperado porque la
 * papeleta había ocupado ese hueco, y el CAS sobre la cabeza acertaba. Se escribía una desestimación
 * sin la objeción que desestima.
 *
 * Y a partir de ahí la decisión quedaba muerta para siempre: `apply` sobre `ObjectionDismissed`
 * busca la objeción con `findObjection` y lanza `UNKNOWN_OBJECTION`; como `replay` pliega el log
 * entero, cualquier lectura, cierre, escrutinio o verificación de esa decisión lanzaba. El historial
 * es de sólo-anexar y el rol de la aplicación no tiene `UPDATE`: no había reparación posible.
 *
 * Ahora la lectura, el sorteo y las dos escrituras ocurren dentro de la misma transacción con el
 * cerrojo tomado, así que una papeleta concurrente espera su turno y la operación se rehace sobre el
 * estado ya actualizado — o falla limpio, que también es correcto.
 *
 * ═══ Autorización: por qué no usa `authorize()` ═══
 *
 * `packages/domain/src/access.ts` no tiene todavía una acción `objection:dismiss` en su matriz —
 * agregarla es una línea en un fichero que no es de mi propiedad de escritura en este encargo (ver
 * `pendiente`). Publicar la desestimación es, en todo lo que importa para el permiso, el mismo tipo
 * de acto de procedimiento que `decision:close` y `decision:ratify`: facilitación o garantías, del
 * propio círculo. Esta ruta replica esa regla exacta a mano, sin pasar por `authorize()` con una
 * acción que no describe lo que está pasando (usar `'decision:close'` para esto haría que un
 * rechazo dijera «no autorizado para decision:close», que es mentira: nadie está cerrando nada).
 *
 * ═══ Por qué la semilla del sorteo es `config.seedCommitment` y no `state.seed` ═══
 *
 * ADR-0024 dice que la semilla compuesta de B.0.3 (`SeedRevealed`, `seedAdmin ‖ beaconValue`) «sirve
 * para... el panel de admisibilidad de objeciones». Pero
 * `packages/domain/src/state-machine.ts` sólo admite `SeedRevealed` desde `Closed`, y
 * `ObjectionRaised`/`ObjectionDismissed` sólo desde `Open`: dos ventanas que nunca coinciden. Con la
 * letra estricta de B.0.3 esta ruta jamás tendría una semilla revelada mientras la objeción todavía
 * se puede desestimar — el mismo «construido e inalcanzable» que este encargo vino a resolver,
 * reaparecido un evento más adelante (ver también la nota de cabecera de
 * `packages/domain/src/sortition-panel.ts`).
 *
 * Mientras esa tensión de la máquina de estados no se resuelva —no le toca a este encargo: no toca
 * `state-machine.ts`, que no es de mi propiedad de escritura; ver `pendiente`—, esta ruta sortea con
 * `config.seedCommitment`: público desde `DecisionOpened`, congelado dentro de `configHash`, y
 * disponible durante TODA la vida de la decisión. Sigue siendo público y reproducible —cualquiera
 * del círculo recalcula su ticket con el mismo compromiso—, pero pierde la propiedad de «faro
 * imposible de conocer de antemano» que sí tiene el escrutinio final: alguien que mire el compromiso
 * al abrirse la decisión ya puede calcular, para cada posible `objectionId`, qué panel saldría. No
 * puede elegir QUIÉN sale —eso lo sigue fijando el compromiso—, pero si algún día alguien controlara
 * además qué texto o qué `objectionId` usar, podría buscar la combinación que le da el panel que
 * prefiere. Reportado; la reparación de fondo (separar la semilla del panel de la del escrutinio, o
 * abrir `SeedRevealed` también en `Open`) es una decisión de arquitectura que excede este encargo.
 *
 * ═══ Qué NO decide esta ruta ═══
 *
 * No decide **si** una objeción se desestima: eso lo decide el panel sorteado, fuera de este
 * sistema (todavía no hay una pantalla ni una papeleta para que el panel vote acá — ADR-0032 lo deja
 * como trabajo futuro). Esta ruta **publica** ese pronunciamiento —cuántos votaron desestimar y con
 * qué motivación— y el motor decide si alcanza. `votos` y `motivacion` los aporta quien llama; el
 * panel nunca los aporta nadie, porque sortearlo es lo único que no se puede confiar a un cliente.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  type Actor,
  appendEvent,
  apply,
  type DecisionEventPayload,
  type DecisionLog,
  type DecisionState,
  eventId,
  instant,
  type MemberId,
  type Objection,
  objectionId as toObjectionId,
  sortObjectionPanel,
  toFractionString,
} from '@koinonia/domain';

import { escribirSobreDecision, ServicioError, type ServicioDeps } from './service.js';

/** Parsea con Zod y deja que `errorDe` en `app.ts` traduzca el `ZodError` (mismo patrón que el
 * resto de las rutas de este directorio: cada fichero define su propio `parse` local). */
function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

const paramsSchema = z.object({ decisionId: z.string(), objectionId: z.string() }).strict();

/**
 * Cuerpo de la petición.
 *
 * `packages/contracts/src/objeciones.ts` ya declara `desestimarObjecion` con exactamente esta
 * forma, pero `packages/contracts/src/index.ts` todavía no la reexporta —esa línea está fuera de mi
 * alcance, la reserva la consigna a un integrador posterior (ver la cabecera de ese fichero, mismo
 * caso que documentó `consenso.ts` con `abrirSondeoSchema`)—. Se repite aquí la misma forma en vez
 * de bloquear esta ruta con un import que hoy no resuelve; cuando se agregue esa línea, este
 * esquema se puede reemplazar por el de `@koinonia/contracts` sin tocar el resto del fichero.
 */
const cuerpoSchema = z
  .object({
    requestId: z.uuid(),
    /** Cuántas de las personas del panel votaron desestimar. */
    votos: z.number().int().nonnegative(),
    /** B.3.a: motivación escrita publicada. No puede ser un campo lleno de nada. */
    motivacion: z
      .string()
      .trim()
      .min(20, 'La motivación tiene que poder leerse: una frase completa, no una palabra.'),
  })
  .strict();

/** Contexto mínimo que esta ruta necesita, separado del contexto general del servidor. */
export interface ContextoObjeciones {
  readonly deps: ServicioDeps;
  /** Mismo cierre que `actorDe` en `app.ts`: no se importa de allí porque no lo exporta. */
  readonly actorDe: (request: FastifyRequest) => Actor;
  /** Mismo cierre que `cupoDeEscritura` en `app.ts`: comprueba el cupo de escritura del actor. */
  readonly cupoDeEscritura: (request: FastifyRequest) => Promise<void>;
}

/**
 * Sella `payload` como el próximo evento de `log` y lo valida contra `state` con `apply` antes de
 * aceptarlo. Es la misma composición que hace la función privada `emit` dentro de `engine.ts`
 * (`appendEvent` + `apply`): no orquesta ninguna order nueva del dominio, sólo repite —porque
 * `emit` no está exportada— cómo se sella un evento que el dominio ya validó.
 */
async function extender(
  deps: ServicioDeps,
  log: DecisionLog,
  state: DecisionState,
  input: {
    readonly actor: MemberId | 'system';
    readonly at: number;
    readonly payload: DecisionEventPayload;
  },
): Promise<{ readonly log: DecisionLog; readonly state: DecisionState }> {
  const event = await appendEvent(log, {
    eventId: eventId(deps.ports.random.opaqueId()),
    decisionId: state.decisionId,
    occurredAt: instant(input.at),
    actor: input.actor,
    payload: input.payload,
  });
  return { log: [...log, event], state: apply(state, event) };
}

export function registrarRutasDeObjeciones(app: FastifyInstance, ctx: ContextoObjeciones): void {
  const { deps } = ctx;

  app.post('/decisiones/:decisionId/objeciones/:objectionId/desestimar', async (request) => {
    await ctx.cupoDeEscritura(request);
    const { decisionId, objectionId: objectionIdRaw } = parse(paramsSchema, request.params);
    const cuerpo = parse(cuerpoSchema, request.body);
    const actor = ctx.actorDe(request);

    if (actor.memberId === undefined) {
      throw new ServicioError(
        'UNAUTHORIZED_NOT_AUTHENTICATED',
        401,
        'desestimar una objeción exige una cuenta verificada',
      );
    }

    /*
     * ═══ Todo lo que sigue va DENTRO del cerrojo, y ése es el arreglo ═══
     *
     * Antes esta ruta leía con `verDecision` —sin transacción y sin cerrojo—, construía hasta dos
     * eventos en memoria y los escribía al final con `persistDecisionLog` sobre el pool, que abre
     * su propia transacción. Era el único escritor del repositorio que quedaba con ese patrón;
     * todos los demás pasan por acá.
     *
     * Lo que eso permitía, y no es teórico: entre la lectura y la escritura cabe una papeleta. Con
     * UNA sola interpuesta —el caso más probable, no el raro— la aritmética de `persistDecisionLog`
     * cuadra por casualidad: `persisted` avanza uno, `pending` se queda sólo con el
     * `ObjectionDismissed` y descarta el `ObjectionRaised` que lo precede, la comprobación de
     * densidad da el número esperado porque la papeleta ocupó ese hueco, y el CAS sobre la cabeza
     * acierta. Se escribe una desestimación sin la objeción que desestima.
     *
     * Y a partir de ahí la decisión queda MUERTA: `apply` sobre `ObjectionDismissed` busca la
     * objeción con `findObjection` y lanza `UNKNOWN_OBJECTION`; como `replay` pliega el log entero,
     * cualquier lectura, cierre, escrutinio o verificación de esa decisión lanza para siempre. El
     * historial es de sólo-anexar y el rol de la aplicación no tiene `UPDATE`: no hay reparación
     * posible desde la aplicación.
     *
     * `escribirSobreDecision` toma el cerrojo ANTES de leer y persiste dentro de la misma
     * transacción, así que la papeleta concurrente espera su turno y la operación se rehace sobre
     * el estado ya actualizado — o falla limpio, que también es correcto.
     */
    // `actor.memberId` ya está comprobado arriba; se fija acá para que el estrechamiento sobreviva
    // dentro del cierre, donde TypeScript ya no puede darlo por hecho.
    const memberId = actor.memberId;
    // Un solo «ahora» para toda la operación: los dos eventos que puede escribir esta ruta tienen
    // que compartir instante, y volver a preguntar el reloj dentro del cerrojo daría dos.
    const at = deps.ports.clock.now();

    let panelSorteado: readonly MemberId[] = [];
    let tamanoDelPanel = 0;
    let umbralDelPanel = '';

    await escribirSobreDecision(deps, decisionId, cuerpo.requestId, async ({ log, state }) => {
      const config = state.config;
      if (config === undefined) {
        throw new ServicioError('ILLEGAL_TRANSITION', 409, 'esa decisión todavía no se ha abierto');
      }
      if (config.method.kind !== 'sociocratic-consent') {
        throw new ServicioError(
          'OBJECTIONS_NOT_APPLICABLE',
          422,
          'este método de decisión no tiene objeciones que desestimar',
        );
      }

      // Ver la cabecera: réplica a mano de la regla de `decision:close`/`decision:ratify`, porque
      // `objection:dismiss` todavía no existe en la matriz de `access.ts`.
      if (!actor.roles.some((role) => role === 'facilitator' || role === 'guarantees')) {
        throw new ServicioError(
          'UNAUTHORIZED_ROLE_NOT_GRANTED',
          403,
          'sólo quien facilita el procedimiento o garantías puede publicar la desestimación de una ' +
            'objeción',
        );
      }
      if (!actor.circles.includes(config.circleId)) {
        throw new ServicioError(
          'UNAUTHORIZED_NOT_IN_CIRCLE',
          403,
          'quien publica la desestimación tiene que pertenecer al círculo de la decisión',
        );
      }

      const objId = toObjectionId(objectionIdRaw);

      let workingLog = log;
      let workingState = state;

      if (!state.objections.some((o) => o.objectionId === objId)) {
        // Ver la cabecera: se publica primero el `ObjectionRaised` implícito en la papeleta.
        const ballot = state.ballots.find(
          (b) =>
            b.payload.kind === 'consent' &&
            b.payload.stance === 'object' &&
            b.payload.objection?.objectionId === objId,
        );
        const objection: Objection | undefined =
          ballot !== undefined && ballot.payload.kind === 'consent'
            ? ballot.payload.objection
            : undefined;
        if (ballot === undefined || objection === undefined) {
          throw new ServicioError(
            'OBJECION_NO_ENCONTRADA',
            404,
            'esa objeción no existe en esta decisión',
          );
        }
        const extendido = await extender(deps, workingLog, workingState, {
          actor: ballot.voter,
          at,
          payload: { type: 'ObjectionRaised', objection, by: ballot.voter },
        });
        workingLog = extendido.log;
        workingState = extendido.state;
      }

      const registrada = workingState.objections.find((o) => o.objectionId === objId);
      if (registrada === undefined) {
        throw new ServicioError(
          'OBJECION_NO_ENCONTRADA',
          404,
          'esa objeción no existe en esta decisión',
        );
      }

      // Ver la cabecera: `config.seedCommitment`, no `state.seed`. `state.seed` (la semilla
      // compuesta y revelada de B.0.3) nunca está disponible acá — es la tensión de la máquina de
      // estados que se documenta arriba —, así que se usa el compromiso, público desde
      // `DecisionOpened` y congelado en `configHash`.
      const { panelSize, dismissThreshold } = config.method.admissibility;
      const sorteo = await sortObjectionPanel({
        electorate: config.electorate,
        circleId: config.circleId,
        objectionId: objId,
        objector: registrada.by,
        panelSize,
        seed: config.seedCommitment,
      });

      const final = await extender(deps, workingLog, workingState, {
        actor: memberId,
        at,
        payload: {
          type: 'ObjectionDismissed',
          objectionId: objId,
          panel: sorteo.panel,
          votes: cuerpo.votos,
          motivation: cuerpo.motivacion,
        },
      });

      // Lo que la respuesta necesita y el cerrojo no devuelve: se saca por cierre, no por retorno,
      // porque `escribirSobreDecision` entrega el log y no lo que esta ruta calculó por el camino.
      panelSorteado = sorteo.panel;
      tamanoDelPanel = panelSize;
      umbralDelPanel = toFractionString(dismissThreshold);

      // Persistir ya no es cosa de esta ruta: lo hace `escribirSobreDecision`, dentro de la misma
      // transacción que tomó el cerrojo y leyó el log.
      return final.log;
    });

    return {
      decisionId,
      objectionId: objectionIdRaw,
      panel: panelSorteado,
      tamanoPanel: tamanoDelPanel,
      votos: cuerpo.votos,
      umbral: umbralDelPanel,
      motivacion: cuerpo.motivacion,
      desestimadaEn: at,
    };
  });
}
